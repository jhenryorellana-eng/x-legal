-- ============================================================
-- 0036_contract_document_snapshot.sql
-- Freeze the assembled contract document into the contract (DOC-51).
--
-- contracts.document_snapshot stores the fully assembled, bilingual contract
-- document ({ es: ContractDocument, en: ContractDocument }) at creation time.
-- Like plan_snapshot/parties_snapshot it is an immutable legal record: editing
-- the service or org config later NEVER alters an already-issued contract. The
-- anonymous signing page + the PDF renderer read this snapshot (self-contained,
-- no live catalog/org lookup needed).
--
-- Also extends create_case_atomic (0026) to write the column in the SAME
-- transaction as the rest of the case, so the freeze is atomic.
--
-- Depends on: 0005_contracts, 0026_create_case_atomic, 0035_contract_parties_and_content
-- Additive only.
-- ============================================================

alter table public.contracts
  add column if not exists document_snapshot jsonb;

comment on column public.contracts.document_snapshot is
  'Frozen, bilingual assembled contract document ({es,en}) rendered on the signing page + PDF. Immutable legal record (DOC-51).';

-- Re-create the atomic creator to also persist contract.document_snapshot.
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

revoke all on function public.create_case_atomic(jsonb) from public, anon, authenticated;
grant execute on function public.create_case_atomic(jsonb) to service_role;
