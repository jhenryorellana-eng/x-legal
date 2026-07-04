-- =============================================================================
-- 0064_fix_create_case_atomic_document_snapshot.sql
-- CORRECTIVE: 0063 re-emitted create_case_atomic from the 0026 body and
-- accidentally dropped the contracts.document_snapshot write added by 0036 —
-- cases created between 0063 and this fix (ULP-2026-0020) have a NULL frozen
-- contract document (the signing page falls back, but the legal record is
-- degraded).
--
-- This re-emits the function with BOTH changes merged:
--   - 0036: contract INSERT persists document_snapshot
--   - 0063: payment_plans INSERT persists frequency (coalesce'd for old payloads)
--
-- Lesson recorded in docs/historial: re-emit RPCs from the LATEST applied
-- definition, never from their original migration.
-- =============================================================================

create or replace function public.create_case_atomic(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c   jsonb := p->'case';
  ct  jsonb := p->'contract';
  pl  jsonb := p->'plan';
  rec jsonb;
  v_case_id     uuid;
  v_contract_id uuid;
  v_plan_id     uuid;
begin
  -- case (status = payment_pending until the downpayment is confirmed)
  insert into public.cases
    (org_id, case_number, service_id, service_plan_id, current_phase_id,
     status, primary_client_id, assigned_paralegal_id, assigned_sales_id)
  values
    ((c->>'org_id')::uuid, c->>'case_number', (c->>'service_id')::uuid,
     (c->>'service_plan_id')::uuid, nullif(c->>'current_phase_id', '')::uuid,
     c->>'status', (c->>'primary_client_id')::uuid,
     nullif(c->>'assigned_paralegal_id', '')::uuid, nullif(c->>'assigned_sales_id', '')::uuid)
  returning id into v_case_id;

  -- case member (primary client = owner)
  insert into public.case_members (case_id, user_id, access_role)
  values (v_case_id, (p->'member'->>'user_id')::uuid, p->'member'->>'access_role');

  -- case parties (person_record_id already resolved by the caller; userId or person)
  for rec in select value from jsonb_array_elements(coalesce(p->'parties', '[]'::jsonb)) loop
    insert into public.case_parties (case_id, person_record_id, user_id, party_role, position)
    values (v_case_id, nullif(rec->>'person_record_id', '')::uuid,
            nullif(rec->>'user_id', '')::uuid, rec->>'party_role', (rec->>'position')::int);
  end loop;

  -- contract (draft; signing_token stays null until sendContractForSigning)
  -- document_snapshot: frozen bilingual contract document (0036, DOC-51)
  insert into public.contracts
    (org_id, case_id, lead_id, service_id, service_plan_id, status,
     plan_snapshot, parties_snapshot, document_snapshot, created_by, terms_version,
     signing_token, signing_expires_at)
  values
    ((ct->>'org_id')::uuid, v_case_id, nullif(ct->>'lead_id', '')::uuid,
     (ct->>'service_id')::uuid, (ct->>'service_plan_id')::uuid, ct->>'status',
     ct->'plan_snapshot', ct->'parties_snapshot', ct->'document_snapshot',
     nullif(ct->>'created_by', '')::uuid,
     nullif(ct->>'terms_version', ''), nullif(ct->>'signing_token', '')::uuid,
     nullif(ct->>'signing_expires_at', '')::timestamptz)
  returning id into v_contract_id;

  -- payment plan (1:1 with the contract; frequency added in 0063)
  insert into public.payment_plans
    (contract_id, total_cents, downpayment_cents, installment_count, frequency, notes)
  values
    (v_contract_id, (pl->>'total_cents')::int, (pl->>'downpayment_cents')::int,
     (pl->>'installment_count')::int, coalesce(pl->>'frequency', 'monthly'),
     nullif(pl->>'notes', ''))
  returning id into v_plan_id;

  -- installments (downpayment + cuotas, computed by the caller)
  for rec in select value from jsonb_array_elements(coalesce(p->'installments', '[]'::jsonb)) loop
    insert into public.installments
      (payment_plan_id, number, is_downpayment, amount_cents, due_date, status)
    values
      (v_plan_id, (rec->>'number')::int, (rec->>'is_downpayment')::boolean,
       (rec->>'amount_cents')::int, (rec->>'due_date')::date, rec->>'status');
  end loop;

  return jsonb_build_object(
    'case_id', v_case_id,
    'contract_id', v_contract_id,
    'plan_id', v_plan_id
  );
end;
$$;

comment on function public.create_case_atomic(jsonb) is
  'Atomic case creation (case+member+parties+contract+plan+installments) in one transaction. Called by cases.createCaseFromContract via service_role. See migrations 0026 + 0036 + 0063 + 0064.';

revoke all on function public.create_case_atomic(jsonb) from public, anon, authenticated;
grant execute on function public.create_case_atomic(jsonb) to service_role;
