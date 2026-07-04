-- =============================================================================
-- 0063_billing_frequency_autopay.sql
-- F1: weekly/monthly installment frequency (per service default + per plan).
-- F2: Stripe autopay — saved card on stripe_customers, per-plan consent,
--     payments.autopay observability flag.
--
-- Additive-only (ADD COLUMN with defaults) so code deployed before this
-- migration keeps working unchanged. create_case_atomic is re-emitted with a
-- coalesce'd `frequency` so old payloads (no frequency key) still insert
-- 'monthly'.
--
-- SoT: DOC-30 §6, DOC-44 §2.1/§3.13, DOC-71 §2.4 (updated 2026-07-03).
-- Rollback: drop the columns/index and re-run migration 0026 for the RPC.
-- =============================================================================

-- --------------------------------------------------------------------------
-- F1: frequency
-- --------------------------------------------------------------------------

alter table public.service_plans
  add column default_frequency text not null default 'monthly'
    constraint service_plans_default_frequency_check
    check (default_frequency in ('weekly', 'monthly'));

alter table public.payment_plans
  add column frequency text not null default 'monthly'
    constraint payment_plans_frequency_check
    check (frequency in ('weekly', 'monthly'));

-- --------------------------------------------------------------------------
-- F2: saved card (1 default card per customer in V2 scope)
-- RLS unchanged: SELECT already limited to owner + billing staff; writes stay
-- service_role-only.
-- --------------------------------------------------------------------------

alter table public.stripe_customers
  add column default_payment_method_id text,
  add column card_brand text,
  add column card_last4 text,
  add column card_exp_month integer,
  add column card_exp_year integer,
  add column pm_updated_at timestamptz;

-- --------------------------------------------------------------------------
-- F2: autopay consent lives on the plan (consent is contractual, per case)
-- --------------------------------------------------------------------------

alter table public.payment_plans
  add column autopay_enabled boolean not null default false,
  add column autopay_consented_at timestamptz,
  add column autopay_consent_by uuid references public.users(id) on delete set null,
  add column autopay_disabled_reason text
    constraint payment_plans_autopay_disabled_reason_check
    check (autopay_disabled_reason in (
      'card_declined_max_retries',
      'authentication_required',
      'customer_request',
      'staff_request',
      'refund_issued'
    ));

-- Observability + derived retry counting (count failed autopay payments per
-- installment instead of a mutable counter — immune to duplicate webhooks).
alter table public.payments
  add column autopay boolean not null default false;

-- The daily charge job scans only enrolled plans.
create index if not exists payment_plans_autopay_idx
  on public.payment_plans (autopay_enabled)
  where autopay_enabled;

-- --------------------------------------------------------------------------
-- create_case_atomic v2 — adds payment_plans.frequency (coalesce keeps old
-- payloads valid during the deploy window). Body otherwise identical to 0026.
-- --------------------------------------------------------------------------

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
  'Atomic case creation (case+member+parties+contract+plan+installments) in one transaction. Called by cases.createCaseFromContract via service_role. See migrations 0026 + 0063.';

revoke all on function public.create_case_atomic(jsonb) from public, anon, authenticated;
grant execute on function public.create_case_atomic(jsonb) to service_role;
