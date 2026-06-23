-- =============================================================================
-- 0026_create_case_atomic.sql
-- Atomic case creation RPC — eliminates the orphaned-case failure mode.
--
-- Problem (observed in prod, case ULP-2026-0002): createCaseFromContract did
-- sequential, non-transactional inserts (case → member → parties → contract →
-- payment_plan → installments). Supabase JS / PostgREST has no multi-table
-- transactions, so a failure after the case row was inserted left an orphan:
-- a case in `payment_pending` with no contract and no payment plan, which the
-- client sees as "no payment plan" and can never pay/activate.
--
-- Fix: do all six writes inside ONE plpgsql function (a single transaction). On
-- any error the whole thing rolls back — no partial case survives.
--
-- The TS service keeps everything else (authz, validation, nextCaseNumber, party
-- role checks, person_records creation, snapshot building, installment math) and
-- passes the computed values as a single jsonb payload. This function only writes,
-- letting the DB generate ids/defaults and wiring the foreign keys internally.
--
-- security definer + empty search_path: runs as owner (bypasses RLS, same as the
-- service client used today); only service_role may execute it.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.create_case_atomic(jsonb);
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
  insert into public.contracts
    (org_id, case_id, lead_id, service_id, service_plan_id, status,
     plan_snapshot, parties_snapshot, created_by, terms_version,
     signing_token, signing_expires_at)
  values
    ((ct->>'org_id')::uuid, v_case_id, nullif(ct->>'lead_id', '')::uuid,
     (ct->>'service_id')::uuid, (ct->>'service_plan_id')::uuid, ct->>'status',
     ct->'plan_snapshot', ct->'parties_snapshot', nullif(ct->>'created_by', '')::uuid,
     nullif(ct->>'terms_version', ''), nullif(ct->>'signing_token', '')::uuid,
     nullif(ct->>'signing_expires_at', '')::timestamptz)
  returning id into v_contract_id;

  -- payment plan (1:1 with the contract)
  insert into public.payment_plans
    (contract_id, total_cents, downpayment_cents, installment_count, notes)
  values
    (v_contract_id, (pl->>'total_cents')::int, (pl->>'downpayment_cents')::int,
     (pl->>'installment_count')::int, nullif(pl->>'notes', ''))
  returning id into v_plan_id;

  -- installments (downpayment + monthly cuotas, computed by the caller)
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
  'Atomic case creation (case+member+parties+contract+plan+installments) in one transaction. Called by cases.createCaseFromContract via service_role. See migration 0026.';

revoke all on function public.create_case_atomic(jsonb) from public, anon, authenticated;
grant execute on function public.create_case_atomic(jsonb) to service_role;
