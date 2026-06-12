-- =============================================================================
-- 07_role_defaults_block.sql
-- DOC-31 §8.2 — Test 8
--
-- Asserts DEFAULT module matrix blocks (DOC-22 §6):
--
--   (a) Sales staff does NOT have 'expedientes' module
--       => SELECT on expedientes yields 0 rows, INSERT raises 42501.
--
--   (b) Finance staff does NOT have 'validations' module
--       => SELECT on legal_validations yields 0 rows.
--
-- Why these pairs?
--   expedientes is exclusively for paralegal (Diana) + admin.
--   legal_validations is exclusively for paralegal (Diana) + admin.
--   sales and finance reach those tables in neither the view nor edit cell.
--   A broken "catch-all staff" policy would give false access here.
--
-- Fixtures (all UUIDs prefix f7…):
--   Org O7  (…g00100)
--   Sales staff  (…g00200) — role=sales, has: leads E, cases V, calendar E, messaging E
--                             explicitly NO expedientes or validations row
--   Finance staff (…g00300) — role=finance, has: billing E, accounting E
--                              explicitly NO validations row
--   Paralegal     (…g00400) — role=paralegal, has: expedientes E, validations E
--                              positive-path control
--   Client        (…g00500) — kind=client
--   Service/phase/plan skeleton
--   Case (…g00700) needed by expediente and legal_validation FK chain
--   Cover template (…g00800) needed to avoid FK issue (not tested directly)
--   Expediente (…g00900) — inserted by postgres; sales must not see it
--   Legal validation (…g00a00) — linked to expediente; finance must not see it
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

-- 8 assertions:
--   T8a: sales sees 0 expedientes
--   T8b: sales INSERT expediente raises 42501
--   T8c: finance sees 0 legal_validations
--   T8d: finance INSERT legal_validation raises 42501 (no validations can_edit)
--   T8e (positive): paralegal sees 1 expediente
--   T8f (positive): paralegal sees 1 legal_validation
--   T8g: sales cannot SELECT cover_templates (no expedientes module)
--   T8h: finance cannot UPDATE legal_validations (service_role-only UPDATE, even with module)
select plan(8);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id         '''f7000000-0000-0000-0000-000000g00100'''
\set sales_id       '''f7000000-0000-0000-0000-000000g00200'''
\set finance_id     '''f7000000-0000-0000-0000-000000g00300'''
\set paralegal_id   '''f7000000-0000-0000-0000-000000g00400'''
\set client_id      '''f7000000-0000-0000-0000-000000g00500'''
\set service_id     '''f7000000-0000-0000-0000-000000g00600'''
\set case_id        '''f7000000-0000-0000-0000-000000g00700'''
\set cover_tmpl_id  '''f7000000-0000-0000-0000-000000g00800'''
\set expediente_id  '''f7000000-0000-0000-0000-000000g00900'''
\set validation_id  '''f7000000-0000-0000-0000-000000g00a00'''
\set svc_plan_id    '''f7000000-0000-0000-0000-000000g00b00'''
\set phase_id       '''f7000000-0000-0000-0000-000000g00c00'''

-- ── Fixtures (postgres = bypass RLS) ─────────────────────────────────────────

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  (:sales_id::uuid,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sales_t7@test.invalid',     now(), now()),
  (:finance_id::uuid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'finance_t7@test.invalid',   now(), now()),
  (:paralegal_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'paralegal_t7@test.invalid', now(), now()),
  (:client_id::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t7@test.invalid',    now(), now());

insert into public.orgs (id, name)
values (:org_id::uuid, 'TestOrg_T7');

insert into public.users (id, org_id, kind, is_active) values
  (:sales_id::uuid,     :org_id::uuid, 'staff',  true),
  (:finance_id::uuid,   :org_id::uuid, 'staff',  true),
  (:paralegal_id::uuid, :org_id::uuid, 'staff',  true),
  (:client_id::uuid,    :org_id::uuid, 'client', true);

insert into public.staff_profiles (user_id, role, display_name) values
  (:sales_id::uuid,     'sales',     'Sales_T7'),
  (:finance_id::uuid,   'finance',   'Finance_T7'),
  (:paralegal_id::uuid, 'paralegal', 'Paralegal_T7');

-- Module permissions reflecting DEFAULT matrix (DOC-22 §6)
-- Sales: leads E, cases V, calendar E — NO expedientes, NO validations
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit) values
  (:sales_id::uuid, 'leads',   true, true),
  (:sales_id::uuid, 'cases',   true, false),
  (:sales_id::uuid, 'calendar',true, true);

-- Finance: billing E, accounting E — NO validations
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit) values
  (:finance_id::uuid, 'billing',    true, true),
  (:finance_id::uuid, 'accounting', true, true);

-- Paralegal: expedientes E, validations E (positive path control)
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit) values
  (:paralegal_id::uuid, 'expedientes', true, true),
  (:paralegal_id::uuid, 'validations', true, true),
  (:paralegal_id::uuid, 'cases',       true, true);

-- Service catalog skeleton
insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t7', 'migratorio',
        '{"es":"Servicio T7","en":"Service T7"}'::jsonb, true);

insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t7',
        '{"es":"Fase T7","en":"Phase T7"}'::jsonb, 1);

insert into public.service_plans (id, service_id, kind, price_cents, currency)
values (:svc_plan_id::uuid, :service_id::uuid, 'self', 60000, 'USD');

-- Case (needed as FK anchor for expediente and legal_validation)
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T7-CASE-1', :service_id::uuid, :svc_plan_id::uuid,
   :client_id::uuid, 'active');

-- Cover template (needed by expediente display; also tests block isolation)
insert into public.cover_templates (id, org_id, name, template, is_active)
values (:cover_tmpl_id::uuid, :org_id::uuid, 'Carátula T7',
        '{"title_i18n":{"es":"Expediente","en":"File"},"fields":[],"style":"ulp-classic"}'::jsonb,
        true);

-- Expediente (inserted as postgres/bypass; sales must not see it)
insert into public.expedientes (id, case_id, attempt_no, status, built_by)
values (:expediente_id::uuid, :case_id::uuid, 1, 'draft', :paralegal_id::uuid);

-- Legal validation (inserted as postgres/bypass; finance must not see it)
-- Requires expediente_id FK
insert into public.legal_validations
  (id, case_id, expediente_id, attempt_no, status)
values
  (:validation_id::uuid, :case_id::uuid, :expediente_id::uuid, 1, 'pending');

-- ── T8a + T8b: Sales — cannot see or insert expedientes ──────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f7000000-0000-0000-0000-000000g00200',
  'role',      'authenticated',
  'org_id',    'f7000000-0000-0000-0000-000000g00100',
  'user_kind', 'staff',
  'user_role', 'sales'
)::text, true);

-- T8a: sales sees 0 expedientes (no expedientes module)
select is_empty(
  $$ select id from public.expedientes $$,
  'T8a: sales staff without expedientes module sees 0 expedientes'
);

-- T8b: sales cannot INSERT an expediente (42501)
select throws_ok(
  $$ insert into public.expedientes (case_id, attempt_no, status, built_by)
     values (
       'f7000000-0000-0000-0000-000000g00700'::uuid,
       2, 'draft',
       'f7000000-0000-0000-0000-000000g00200'::uuid
     ) $$,
  '42501',
  null,
  'T8b: sales staff cannot INSERT expedientes (no module)'
);

-- T8g: sales cannot SELECT cover_templates (same expedientes module gate)
select is_empty(
  $$ select id from public.cover_templates $$,
  'T8g: sales staff without expedientes module sees 0 cover_templates'
);

-- ── T8c + T8d: Finance — cannot see or insert legal_validations ───────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f7000000-0000-0000-0000-000000g00300',
  'role',      'authenticated',
  'org_id',    'f7000000-0000-0000-0000-000000g00100',
  'user_kind', 'staff',
  'user_role', 'finance'
)::text, true);

-- T8c: finance sees 0 legal_validations (no validations module)
select is_empty(
  $$ select id from public.legal_validations $$,
  'T8c: finance staff without validations module sees 0 legal_validations'
);

-- T8d: finance cannot INSERT a legal_validation (42501 — no validations can_edit)
select throws_ok(
  $$ insert into public.legal_validations
       (case_id, expediente_id, attempt_no, status)
     values (
       'f7000000-0000-0000-0000-000000g00700'::uuid,
       'f7000000-0000-0000-0000-000000g00900'::uuid,
       2, 'pending'
     ) $$,
  '42501',
  null,
  'T8d: finance staff cannot INSERT legal_validations (no validations module)'
);

-- ── T8e + T8f: Paralegal — positive path control ─────────────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f7000000-0000-0000-0000-000000g00400',
  'role',      'authenticated',
  'org_id',    'f7000000-0000-0000-0000-000000g00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T8e: paralegal sees 1 expediente (has expedientes module)
select results_eq(
  $$ select count(*)::bigint from public.expedientes $$,
  $$ values (1::bigint) $$,
  'T8e: paralegal with expedientes module sees the expediente'
);

-- T8f: paralegal sees 1 legal_validation (has validations module)
select results_eq(
  $$ select count(*)::bigint from public.legal_validations $$,
  $$ values (1::bigint) $$,
  'T8f: paralegal with validations module sees the legal_validation'
);

-- T8h: finance cannot UPDATE legal_validations even if they had the validations
--      module — UPDATE has NO policy for authenticated (service_role-only verdicts).
--      We test this via the paralegal session which HAS validations module (stronger test:
--      even the user with the module cannot UPDATE — it's service_role-only).
-- T8h: paralegal (has validations) still cannot UPDATE legal_validations
select throws_ok(
  $$ update public.legal_validations
     set status = 'sent'
     where id = 'f7000000-0000-0000-0000-000000g00a00'::uuid $$,
  '42501',
  null,
  'T8h: legal_validations UPDATE is service_role-only; even validations module holder cannot UPDATE'
);

select * from finish();
rollback;
