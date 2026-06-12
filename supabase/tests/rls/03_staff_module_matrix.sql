-- =============================================================================
-- 03_staff_module_matrix.sql
-- DOC-31 §8.2 — Test 12
--
-- Asserts the three-state module matrix for a staff user:
--   (a) No row in employee_module_permissions for module X
--       => has_module('X', false) = false => 0 rows visible
--   (b) can_view=true (can_edit=false)
--       => has_module('X', false) = true  => rows visible
--       => has_module('X', true)  = false => INSERT/UPDATE blocked (42501)
--   (c) can_edit=true
--       => has_module('X', true)  = true  => INSERT succeeds
--
-- Admin bypass is also tested: admin staff (role='admin') sees everything
-- without any rows in employee_module_permissions.
--
-- Tables exercised: cases (module 'cases'), employee_module_permissions.
-- INSERT/UPDATE tests use throws_ok expecting SQLSTATE 42501.
--
-- Fixtures:
--   Org O3 (…c001)
--   Staff-no-module (…c002) — paralegal, NO cases permission row
--   Staff-view (…c003)      — paralegal, cases can_view=true  can_edit=false
--   Staff-edit (…c004)      — paralegal, cases can_view=true  can_edit=true
--   Admin staff (…c005)     — role=admin (no emp_module_permissions rows needed)
--   Case (…c006) in org O3
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id       '''f3000000-0000-0000-0000-000000c00100'''
\set staff_none   '''f3000000-0000-0000-0000-000000c00200'''
\set staff_view   '''f3000000-0000-0000-0000-000000c00300'''
\set staff_edit   '''f3000000-0000-0000-0000-000000c00400'''
\set staff_admin  '''f3000000-0000-0000-0000-000000c00500'''
\set case_id      '''f3000000-0000-0000-0000-000000c00600'''
\set client_id    '''f3000000-0000-0000-0000-000000c00700'''
\set service_id   '''f3000000-0000-0000-0000-000000c00800'''
\set plan_id      '''f3000000-0000-0000-0000-000000c00900'''
\set phase_id     '''f3000000-0000-0000-0000-000000c00a00'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  (:staff_none::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_none_t3@test.invalid',  now(), now()),
  (:staff_view::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_view_t3@test.invalid',  now(), now()),
  (:staff_edit::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_edit_t3@test.invalid',  now(), now()),
  (:staff_admin::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_admin_t3@test.invalid', now(), now()),
  (:client_id::uuid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t3@test.invalid',      now(), now());

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T3');

insert into public.users (id, org_id, kind, is_active) values
  (:staff_none::uuid,  :org_id::uuid, 'staff',  true),
  (:staff_view::uuid,  :org_id::uuid, 'staff',  true),
  (:staff_edit::uuid,  :org_id::uuid, 'staff',  true),
  (:staff_admin::uuid, :org_id::uuid, 'staff',  true),
  (:client_id::uuid,   :org_id::uuid, 'client', true);

insert into public.staff_profiles (user_id, role, display_name) values
  (:staff_none::uuid,  'paralegal', 'NoModuleParalegal'),
  (:staff_view::uuid,  'paralegal', 'ViewParalegal'),
  (:staff_edit::uuid,  'paralegal', 'EditParalegal'),
  (:staff_admin::uuid, 'admin',     'AdminUser');

-- Module permission rows: only for staff_view (view only) and staff_edit (view+edit)
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit)
values
  (:staff_view::uuid, 'cases', true,  false),
  (:staff_edit::uuid, 'cases', true,  true);
-- staff_none: intentionally no row for 'cases'
-- staff_admin: no rows needed (admin bypass)

-- service catalog skeleton
insert into public.services (id, org_id, name_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, '{"es":"Svc T3","en":"Svc T3"}'::jsonb, true);

insert into public.service_phases (id, service_id, name_i18n, position)
values (:phase_id::uuid, :service_id::uuid, '{"es":"Fase","en":"Phase"}'::jsonb, 1);

insert into public.service_plans (id, service_id, name_i18n, price, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, '{"es":"Plan T3","en":"Plan T3"}'::jsonb, 100, 'USD', true);

-- existing case (INSERT by postgres/bypass before test scenarios)
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T3-CASE-1', :service_id::uuid, :plan_id::uuid,
   :client_id::uuid, 'active');

-- ── (a) staff with NO module row: 0 rows visible, INSERT blocked ─────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f3000000-0000-0000-0000-000000c00200',
  'role',      'authenticated',
  'org_id',    'f3000000-0000-0000-0000-000000c00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T12a: staff without module sees 0 cases
select is_empty(
  $$ select id from public.cases $$,
  'T12a: staff with no cases module row sees 0 cases'
);

-- T12b: staff without module cannot INSERT a case (42501)
select throws_ok(
  $$ insert into public.cases
       (id, org_id, case_number, service_id, service_plan_id, primary_client_id)
     values (
       'f3000000-0000-0000-0000-000000c00b00'::uuid,
       'f3000000-0000-0000-0000-000000c00100'::uuid,
       'T3-BLOCKED-1',
       'f3000000-0000-0000-0000-000000c00800'::uuid,
       'f3000000-0000-0000-0000-000000c00900'::uuid,
       'f3000000-0000-0000-0000-000000c00700'::uuid
     ) $$,
  '42501',
  null,
  'T12b: staff with no module cannot INSERT a case'
);

-- ── (b) staff with can_view=true, can_edit=false ──────────────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f3000000-0000-0000-0000-000000c00300',
  'role',      'authenticated',
  'org_id',    'f3000000-0000-0000-0000-000000c00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T12c: view-only staff sees the case
select results_eq(
  $$ select count(*)::bigint from public.cases $$,
  $$ values (1::bigint) $$,
  'T12c: staff with can_view=true sees cases'
);

-- T12d: view-only staff cannot INSERT a case (42501 — needs can_edit)
select throws_ok(
  $$ insert into public.cases
       (id, org_id, case_number, service_id, service_plan_id, primary_client_id)
     values (
       'f3000000-0000-0000-0000-000000c00c00'::uuid,
       'f3000000-0000-0000-0000-000000c00100'::uuid,
       'T3-BLOCKED-2',
       'f3000000-0000-0000-0000-000000c00800'::uuid,
       'f3000000-0000-0000-0000-000000c00900'::uuid,
       'f3000000-0000-0000-0000-000000c00700'::uuid
     ) $$,
  '42501',
  null,
  'T12d: staff with can_view only cannot INSERT a case'
);

-- ── (c) staff with can_edit=true: sees + can insert ──────────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f3000000-0000-0000-0000-000000c00400',
  'role',      'authenticated',
  'org_id',    'f3000000-0000-0000-0000-000000c00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T12e: edit staff sees the case
select results_eq(
  $$ select count(*)::bigint from public.cases $$,
  $$ values (1::bigint) $$,
  'T12e: staff with can_edit=true sees cases'
);

-- T12f: edit staff can INSERT a case
select lives_ok(
  $$ insert into public.cases
       (id, org_id, case_number, service_id, service_plan_id, primary_client_id)
     values (
       'f3000000-0000-0000-0000-000000c00d00'::uuid,
       'f3000000-0000-0000-0000-000000c00100'::uuid,
       'T3-ALLOWED-1',
       'f3000000-0000-0000-0000-000000c00800'::uuid,
       'f3000000-0000-0000-0000-000000c00900'::uuid,
       'f3000000-0000-0000-0000-000000c00700'::uuid
     ) $$,
  'T12f: staff with can_edit=true can INSERT a case'
);

-- ── (d) Admin bypass: no emp_module_permissions rows, still sees cases ────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f3000000-0000-0000-0000-000000c00500',
  'role',      'authenticated',
  'org_id',    'f3000000-0000-0000-0000-000000c00100',
  'user_kind', 'staff',
  'user_role', 'admin'
)::text, true);

-- T12g: admin sees cases without any module permission rows
select results_eq(
  $$ select count(*)::bigint from public.cases $$,
  $$ values (2::bigint) $$,
  'T12g: admin bypasses module matrix and sees all cases in their org'
);

-- T12h: admin can INSERT a case (edit implicit via bypass)
select lives_ok(
  $$ insert into public.cases
       (id, org_id, case_number, service_id, service_plan_id, primary_client_id)
     values (
       'f3000000-0000-0000-0000-000000c00e00'::uuid,
       'f3000000-0000-0000-0000-000000c00100'::uuid,
       'T3-ADMIN-1',
       'f3000000-0000-0000-0000-000000c00800'::uuid,
       'f3000000-0000-0000-0000-000000c00900'::uuid,
       'f3000000-0000-0000-0000-000000c00700'::uuid
     ) $$,
  'T12h: admin can INSERT a case without any module permission row'
);

-- T12i: admin sees employee_module_permissions (matrix management)
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f3000000-0000-0000-0000-000000c00500',
  'role',      'authenticated',
  'org_id',    'f3000000-0000-0000-0000-000000c00100',
  'user_kind', 'staff',
  'user_role', 'admin'
)::text, true);

select results_eq(
  $$ select count(*)::bigint from public.employee_module_permissions $$,
  $$ values (2::bigint) $$,
  'T12i: admin can read all employee_module_permissions rows'
);

select * from finish();
rollback;
