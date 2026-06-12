-- =============================================================================
-- 06_billing_module_gate.sql
-- DOC-31 §8.2 — Tests 6 and 7
--
-- Test 6: Paralegal (role='paralegal') without 'billing' module row cannot
--         SELECT installments or payments. Finance staff WITH 'billing' CAN.
--
-- Test 7: Paralegal without 'accounting' module row cannot SELECT
--         ledger_entries. Finance staff WITH 'accounting' CAN.
--
-- Design:
--   - Fixtures create rows in installments, payments and ledger_entries so
--     that a broken policy would return >0 rows (no false-green on empty tables).
--   - Payment chain: contract -> payment_plan -> installment -> payment.
--   - ledger_entries chain: org -> ledger_entry (org_id root table).
--   - Paralegal has NO billing/accounting rows in employee_module_permissions.
--   - Finance staff has billing=E and accounting=E.
--
-- Fixtures (all UUIDs unique to this file, prefix f6…):
--   Org O6 (…f00100)
--   Staff paralegal (…f00200) — kind=staff, role=paralegal, NO billing/accounting rows
--   Staff finance   (…f00300) — kind=staff, role=finance, has billing E + accounting E
--   Client          (…f00400) — kind=client, member of Case
--   Service/plan/phase skeleton
--   Case (…f00600)
--   Contract (…f00700) -> payment_plan (…f00800) -> installment (…f00900) -> payment (…f00a00)
--   ledger_entry (…f00b00)
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

-- 10 assertions total:
--   T6a: paralegal sees 0 installments (no billing module)
--   T6b: paralegal sees 0 payments      (no billing module)
--   T6c: finance sees 1 installment     (has billing)
--   T6d: finance sees 1 payment         (has billing)
--   T7a: paralegal sees 0 ledger_entries (no accounting module)
--   T7b: finance sees 1 ledger_entry     (has accounting)
-- + 4 positive-path sanity assertions (count checks for finance)
select plan(10);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id        '''f6000000-0000-0000-0000-000000f00100'''
\set paralegal_id  '''f6000000-0000-0000-0000-000000f00200'''
\set finance_id    '''f6000000-0000-0000-0000-000000f00300'''
\set client_id     '''f6000000-0000-0000-0000-000000f00400'''
\set service_id    '''f6000000-0000-0000-0000-000000f00500'''
\set case_id       '''f6000000-0000-0000-0000-000000f00600'''
\set contract_id   '''f6000000-0000-0000-0000-000000f00700'''
\set plan_id       '''f6000000-0000-0000-0000-000000f00800'''
\set installment_id '''f6000000-0000-0000-0000-000000f00900'''
\set payment_id    '''f6000000-0000-0000-0000-000000f00a00'''
\set ledger_id     '''f6000000-0000-0000-0000-000000f00b00'''
\set svc_plan_id   '''f6000000-0000-0000-0000-000000f00c00'''
\set phase_id      '''f6000000-0000-0000-0000-000000f00d00'''

-- ── Fixtures (running as postgres = bypass RLS) ───────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:paralegal_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'paralegal_t6@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:finance_id::uuid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'finance_t6@test.invalid',   now(), now(), '', '', '', '', '', '', '', ''),
  (:client_id::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t6@test.invalid',    now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name)
values (:org_id::uuid, 'TestOrg_T6');

insert into public.users (id, org_id, kind, is_active) values
  (:paralegal_id::uuid, :org_id::uuid, 'staff',  true),
  (:finance_id::uuid,   :org_id::uuid, 'staff',  true),
  (:client_id::uuid,    :org_id::uuid, 'client', true);

insert into public.staff_profiles (user_id, role, display_name) values
  (:paralegal_id::uuid, 'paralegal', 'Paralegal_T6'),
  (:finance_id::uuid,   'finance',   'Finance_T6');

-- Paralegal: intentionally NO billing or accounting rows
-- Finance: billing=E and accounting=E
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit) values
  (:finance_id::uuid, 'billing',    true, true),
  (:finance_id::uuid, 'accounting', true, true);

-- Service catalog skeleton (slug and category required by real schema)
insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t6', 'migratorio',
        '{"es":"Servicio T6","en":"Service T6"}'::jsonb, true);

insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t6',
        '{"es":"Fase T6","en":"Phase T6"}'::jsonb, 1);

insert into public.service_plans (id, service_id, kind, price_cents, currency)
values (:svc_plan_id::uuid, :service_id::uuid, 'self', 50000, 'USD');

-- Case
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T6-CASE-1', :service_id::uuid, :svc_plan_id::uuid,
   :client_id::uuid, 'active');

insert into public.case_members (case_id, user_id, access_role)
values (:case_id::uuid, :client_id::uuid, 'owner');

-- Contract (required by payment_plans FK)
-- plan_snapshot and parties_snapshot are NOT NULL
insert into public.contracts
  (id, org_id, case_id, service_id, service_plan_id, plan_snapshot, parties_snapshot, status)
values
  (:contract_id::uuid, :org_id::uuid, :case_id::uuid,
   :service_id::uuid, :svc_plan_id::uuid,
   '{"price_cents":50000,"currency":"USD"}'::jsonb,
   '[]'::jsonb,
   'signed');

-- Payment plan
insert into public.payment_plans
  (id, contract_id, total_cents, downpayment_cents, installment_count)
values
  (:plan_id::uuid, :contract_id::uuid, 50000, 5000, 2);

-- Installment
insert into public.installments
  (id, payment_plan_id, number, amount_cents, due_date, status)
values
  (:installment_id::uuid, :plan_id::uuid, 1, 25000, current_date + 30, 'pending');

-- Payment (Zelle proof registered by finance as postgres/bypass)
insert into public.payments
  (id, installment_id, method, amount_cents, payer_user_id, status)
values
  (:payment_id::uuid, :installment_id::uuid, 'zelle', 25000,
   :client_id::uuid, 'pending');

-- Ledger entry (manual entry by finance recorded as postgres/bypass)
insert into public.ledger_entries
  (id, org_id, entry_date, kind, category, amount_cents, case_id, recorded_by)
values
  (:ledger_id::uuid, :org_id::uuid, current_date, 'income', 'cuota', 25000,
   :case_id::uuid, :finance_id::uuid);

-- ── T6: Paralegal (no billing module) — sees 0 installments and 0 payments ───
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f6000000-0000-0000-0000-000000f00200',
  'role',      'authenticated',
  'org_id',    'f6000000-0000-0000-0000-000000f00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T6a: paralegal sees 0 installments (billing module absent)
select is_empty(
  $$ select id from public.installments $$,
  'T6a: paralegal without billing module sees 0 installments'
);

-- T6b: paralegal sees 0 payments (billing module absent)
select is_empty(
  $$ select id from public.payments $$,
  'T6b: paralegal without billing module sees 0 payments'
);

-- ── T7: Paralegal (no accounting module) — sees 0 ledger_entries ──────────────
-- Still acting as paralegal (already set above); accounting module also absent

-- T7a: paralegal sees 0 ledger_entries (accounting module absent)
select is_empty(
  $$ select id from public.ledger_entries $$,
  'T7a: paralegal without accounting module sees 0 ledger_entries'
);

-- ── T6/T7 positive path: Finance (has billing + accounting) — sees all rows ───
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f6000000-0000-0000-0000-000000f00300',
  'role',      'authenticated',
  'org_id',    'f6000000-0000-0000-0000-000000f00100',
  'user_kind', 'staff',
  'user_role', 'finance'
)::text, true);

-- T6c: finance sees 1 installment (billing=E)
select results_eq(
  $$ select count(*)::bigint from public.installments $$,
  $$ values (1::bigint) $$,
  'T6c: finance staff with billing module sees installments'
);

-- T6d: finance sees 1 payment (billing=E)
select results_eq(
  $$ select count(*)::bigint from public.payments $$,
  $$ values (1::bigint) $$,
  'T6d: finance staff with billing module sees payments'
);

-- T7b: finance sees 1 ledger_entry (accounting=E)
select results_eq(
  $$ select count(*)::bigint from public.ledger_entries $$,
  $$ values (1::bigint) $$,
  'T7b: finance staff with accounting module sees ledger_entries'
);

-- ── Additional: paralegal cannot INSERT installments (42501) ──────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f6000000-0000-0000-0000-000000f00200',
  'role',      'authenticated',
  'org_id',    'f6000000-0000-0000-0000-000000f00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T6e: paralegal cannot INSERT an installment (no billing can_edit)
select throws_ok(
  $$ insert into public.installments
       (payment_plan_id, number, amount_cents, due_date, status)
     values (
       'f6000000-0000-0000-0000-000000f00800'::uuid,
       2, 25000, current_date + 60, 'pending'
     ) $$,
  '42501',
  null,
  'T6e: paralegal without billing cannot INSERT installments'
);

-- T7c: paralegal cannot INSERT a ledger_entry (no accounting can_edit)
select throws_ok(
  $$ insert into public.ledger_entries
       (org_id, entry_date, kind, category, amount_cents, recorded_by)
     values (
       'f6000000-0000-0000-0000-000000f00100'::uuid,
       current_date, 'expense', 'otros', 1000,
       'f6000000-0000-0000-0000-000000f00200'::uuid
     ) $$,
  '42501',
  null,
  'T7c: paralegal without accounting cannot INSERT ledger_entries'
);

-- T6f: paralegal cannot UPDATE an installment (no billing can_edit)
select throws_ok(
  $$ update public.installments
     set status = 'paid'
     where id = 'f6000000-0000-0000-0000-000000f00900'::uuid $$,
  '42501',
  null,
  'T6f: paralegal without billing cannot UPDATE installments'
);

-- T7d: paralegal cannot UPDATE a ledger_entry (no accounting can_edit)
select throws_ok(
  $$ update public.ledger_entries
     set description = 'hacked'
     where id = 'f6000000-0000-0000-0000-000000f00b00'::uuid $$,
  '42501',
  null,
  'T7d: paralegal without accounting cannot UPDATE ledger_entries'
);

select * from finish();
rollback;
