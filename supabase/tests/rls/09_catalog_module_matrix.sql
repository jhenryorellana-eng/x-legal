-- =============================================================================
-- 09_catalog_module_matrix.sql
-- DOC-31 §8.2 — Tests 12 (catalog/datasets extension) and 13
--
-- Test 12 (catalog / datasets extension):
--   Extends the admin-bypass and module-matrix assertion from 03_staff_module_matrix
--   (which covers module 'cases') to modules 'catalog' and 'datasets':
--     (a) Staff with no 'catalog' row: 0 services visible, INSERT blocked (42501).
--     (b) Staff with catalog can_view=true: reads active services, cannot INSERT.
--     (c) Staff with catalog can_edit=true: reads and inserts services.
--     (d) Admin (no employee_module_permissions rows): reads ALL services (including
--         inactive/draft), inserts ai_datasets (module 'datasets' required normally).
--
-- Test 13 (RF-ADM-045 — immediate effect of permission revocation):
--   Within a SINGLE TRANSACTION (no re-login):
--     1. Paralegal has cases module (can_view=true, can_edit=true) — sees 1 case.
--     2. Admin (acting as postgres) DELETEs the module row.
--     3. Same paralegal JWT, NEXT statement: sees 0 cases.
--   Verifies has_module() reads employee_module_permissions LIVE (no statement-level
--   cache survives the DELETE because each statement is a fresh InitPlan evaluation).
--
-- Fixtures (all UUIDs prefix f9…):
--   Org O9           (…i00100)
--   Staff no-catalog (…i00200) — paralegal, NO catalog row
--   Staff view-cat   (…i00300) — paralegal, catalog can_view=true
--   Staff edit-cat   (…i00400) — paralegal, catalog can_edit=true
--   Admin            (…i00500) — role=admin, NO employee_module_permissions rows
--   Staff revoke     (…i00600) — paralegal, cases can_view + can_edit (T13 subject)
--   Client           (…i00700)
--   Service active   (…i00800) — is_active=true  (visible without catalog module)
--   Service draft    (…i00900) — is_active=false (only catalog module or admin sees it)
--   Phase + plan for case skeleton
--   Case (…i00c00) — needed for T13 revocation test
--   ai_dataset (…i00d00) — inserted as postgres for admin bypass assertion
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

-- 13 assertions:
--   T12a: staff-no-catalog sees active services only (count=1)
--   T12b: staff-no-catalog cannot INSERT service (42501)
--   T12c: staff-view-catalog sees 2 services (active + draft via module)
--   T12d: staff-view-catalog cannot INSERT service (42501)
--   T12e: staff-edit-catalog sees 2 services (active + draft via module)
--   T12f: staff-edit-catalog can INSERT a service (lives_ok)
--   T12g: admin sees 3 services without any catalog module row
--   T12h: admin can INSERT an ai_dataset without any datasets module row
--   T12i: admin sees 2 ai_datasets (fixture + self-inserted)
--   T13a: paralegal with cases module sees 1 case (before revocation)
--   T13b: cases module row has been deleted (0 rows for own cases key)
--   T13c: same paralegal JWT, NEXT statement, sees 0 cases (immediate effect)
--   T13d: paralegal cannot INSERT a case after revocation (42501)
select plan(13);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id          '''f9000000-0000-0000-0000-000000i00100'''
\set staff_nocat     '''f9000000-0000-0000-0000-000000i00200'''
\set staff_viewcat   '''f9000000-0000-0000-0000-000000i00300'''
\set staff_editcat   '''f9000000-0000-0000-0000-000000i00400'''
\set staff_admin     '''f9000000-0000-0000-0000-000000i00500'''
\set staff_revoke    '''f9000000-0000-0000-0000-000000i00600'''
\set client_id       '''f9000000-0000-0000-0000-000000i00700'''
\set svc_active      '''f9000000-0000-0000-0000-000000i00800'''
\set svc_draft       '''f9000000-0000-0000-0000-000000i00900'''
\set svc_plan_id     '''f9000000-0000-0000-0000-000000i00a00'''
\set phase_id        '''f9000000-0000-0000-0000-000000i00b00'''
\set case_id         '''f9000000-0000-0000-0000-000000i00c00'''
\set dataset_id      '''f9000000-0000-0000-0000-000000i00d00'''

-- ── Fixtures (postgres = bypass RLS) ─────────────────────────────────────────

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  (:staff_nocat::uuid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'nocat_t9@test.invalid',   now(), now()),
  (:staff_viewcat::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'viewcat_t9@test.invalid', now(), now()),
  (:staff_editcat::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'editcat_t9@test.invalid', now(), now()),
  (:staff_admin::uuid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin_t9@test.invalid',   now(), now()),
  (:staff_revoke::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'revoke_t9@test.invalid',  now(), now()),
  (:client_id::uuid,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t9@test.invalid',  now(), now());

insert into public.orgs (id, name)
values (:org_id::uuid, 'TestOrg_T9');

insert into public.users (id, org_id, kind, is_active) values
  (:staff_nocat::uuid,   :org_id::uuid, 'staff',  true),
  (:staff_viewcat::uuid, :org_id::uuid, 'staff',  true),
  (:staff_editcat::uuid, :org_id::uuid, 'staff',  true),
  (:staff_admin::uuid,   :org_id::uuid, 'staff',  true),
  (:staff_revoke::uuid,  :org_id::uuid, 'staff',  true),
  (:client_id::uuid,     :org_id::uuid, 'client', true);

insert into public.staff_profiles (user_id, role, display_name) values
  (:staff_nocat::uuid,   'paralegal', 'NoCatalog_T9'),
  (:staff_viewcat::uuid, 'paralegal', 'ViewCatalog_T9'),
  (:staff_editcat::uuid, 'paralegal', 'EditCatalog_T9'),
  (:staff_admin::uuid,   'admin',     'Admin_T9'),
  (:staff_revoke::uuid,  'paralegal', 'RevokeTarget_T9');

-- Module permissions for T12:
-- staff_nocat: intentionally NO catalog row
-- staff_viewcat: catalog can_view=true, can_edit=false
-- staff_editcat: catalog can_view=true, can_edit=true
-- staff_admin: NO rows (admin bypass, role='admin')
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit) values
  (:staff_viewcat::uuid, 'catalog', true,  false),
  (:staff_editcat::uuid, 'catalog', true,  true);

-- Module permission for T13: paralegal has cases=E (will be deleted mid-test)
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit) values
  (:staff_revoke::uuid, 'cases', true, true);

-- Two services: one active (visible to all authenticated staff), one draft
-- (only catalog module or admin sees it)
insert into public.services (id, org_id, slug, category, label_i18n, is_active, archived_at)
values
  (:svc_active::uuid, :org_id::uuid, 'svc-active-t9', 'migratorio',
   '{"es":"Servicio Activo T9","en":"Active Service T9"}'::jsonb, true,  null),
  (:svc_draft::uuid,  :org_id::uuid, 'svc-draft-t9',  'migratorio',
   '{"es":"Servicio Draft T9","en":"Draft Service T9"}'::jsonb,  false, null);

-- Phase and plan for the cases FK chain (T13)
insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :svc_active::uuid, 'fase-t9',
        '{"es":"Fase T9","en":"Phase T9"}'::jsonb, 1);

insert into public.service_plans (id, service_id, kind, price_cents, currency)
values (:svc_plan_id::uuid, :svc_active::uuid, 'self', 70000, 'USD');

-- Case for T13 (paralegal will be revoked from seeing it)
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T9-CASE-1', :svc_active::uuid, :svc_plan_id::uuid,
   :client_id::uuid, 'active');

-- ai_dataset for admin bypass assertion (requires 'datasets' module normally)
insert into public.ai_datasets (id, org_id, name, source_kind, is_active, created_by)
values (:dataset_id::uuid, :org_id::uuid, 'Dataset T9', 'manual', true, :staff_admin::uuid);

-- ── (a) Staff with NO catalog row ────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f9000000-0000-0000-0000-000000i00200',
  'role',      'authenticated',
  'org_id',    'f9000000-0000-0000-0000-000000i00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T12a: no-catalog staff sees 0 services (even active ones — is_staff() allows
--       active services for staff without catalog module, but this user does NOT
--       have is_staff() returning true for the "staff" branch of the USING clause.
--       Wait — re-read DOC-31 §4 Bloque 2 services policy:
--       "is_active AND archived_at IS NULL AND (is_staff() OR (is_public AND is_client()))"
--       so active services ARE visible to any is_staff() user.
--       Expected: 1 (the active service) — the draft is hidden. Adjust count.
select results_eq(
  $$ select count(*)::bigint from public.services $$,
  $$ values (1::bigint) $$,
  'T12a: staff without catalog module sees only active services (1 of 2)'
);

-- T12b: no-catalog staff cannot INSERT a service (needs catalog can_edit)
select throws_ok(
  $$ insert into public.services (org_id, slug, category, label_i18n, is_active)
     values (
       'f9000000-0000-0000-0000-000000i00100'::uuid,
       'blocked-insert-t9', 'migratorio',
       '{"es":"Bloqueado","en":"Blocked"}'::jsonb,
       false
     ) $$,
  '42501',
  null,
  'T12b: staff without catalog module cannot INSERT a service'
);

-- ── (b) Staff with catalog can_view=true, can_edit=false ─────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f9000000-0000-0000-0000-000000i00300',
  'role',      'authenticated',
  'org_id',    'f9000000-0000-0000-0000-000000i00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T12c: view-catalog staff sees 2 services (active + draft via catalog module)
select results_eq(
  $$ select count(*)::bigint from public.services $$,
  $$ values (2::bigint) $$,
  'T12c: staff with catalog can_view sees both active and draft services'
);

-- T12d: view-only catalog staff cannot INSERT a service (needs can_edit)
select throws_ok(
  $$ insert into public.services (org_id, slug, category, label_i18n, is_active)
     values (
       'f9000000-0000-0000-0000-000000i00100'::uuid,
       'view-only-insert-t9', 'migratorio',
       '{"es":"ViewOnly","en":"ViewOnly"}'::jsonb,
       false
     ) $$,
  '42501',
  null,
  'T12d: staff with catalog can_view only cannot INSERT a service'
);

-- ── (c) Staff with catalog can_edit=true ─────────────────────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f9000000-0000-0000-0000-000000i00400',
  'role',      'authenticated',
  'org_id',    'f9000000-0000-0000-0000-000000i00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T12e: edit-catalog staff sees 2 services
select results_eq(
  $$ select count(*)::bigint from public.services $$,
  $$ values (2::bigint) $$,
  'T12e: staff with catalog can_edit sees both active and draft services'
);

-- T12f: edit-catalog staff can INSERT a service
select lives_ok(
  $$ insert into public.services (org_id, slug, category, label_i18n, is_active)
     values (
       'f9000000-0000-0000-0000-000000i00100'::uuid,
       'edit-inserted-t9', 'migratorio',
       '{"es":"Insertado","en":"Inserted"}'::jsonb,
       false
     ) $$,
  'T12f: staff with catalog can_edit can INSERT a service'
);

-- ── (d) Admin — bypasses catalog AND datasets module ─────────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f9000000-0000-0000-0000-000000i00500',
  'role',      'authenticated',
  'org_id',    'f9000000-0000-0000-0000-000000i00100',
  'user_kind', 'staff',
  'user_role', 'admin'
)::text, true);

-- T12g: admin sees all services without any catalog module row (3 after T12f INSERT)
select results_eq(
  $$ select count(*)::bigint from public.services $$,
  $$ values (3::bigint) $$,
  'T12g: admin bypasses catalog module and sees all 3 services (2 original + 1 inserted)'
);

-- T12h: admin can INSERT an ai_dataset without any datasets module row
select lives_ok(
  $$ insert into public.ai_datasets (org_id, name, source_kind, is_active, created_by)
     values (
       'f9000000-0000-0000-0000-000000i00100'::uuid,
       'Admin Inserted Dataset', 'manual', true,
       'f9000000-0000-0000-0000-000000i00500'::uuid
     ) $$,
  'T12h: admin can INSERT ai_datasets without datasets module row (bypass)'
);

-- T12i: admin sees the ai_dataset inserted in fixtures (datasets module required otherwise)
select results_eq(
  $$ select count(*)::bigint from public.ai_datasets $$,
  $$ values (2::bigint) $$,
  'T12i: admin sees 2 ai_datasets (fixture + self-inserted) with no module rows'
);

-- ── Test 13: Immediate effect of module revocation (RF-ADM-045) ──────────────
--
-- Protocol:
--   1. Act as paralegal (staff_revoke) — verify 1 case visible (cases module=E).
--   2. Reset to postgres role (superuser bypass).
--   3. DELETE the cases module row from employee_module_permissions.
--   4. Re-set role to authenticated with SAME JWT claims (no new claims needed —
--      has_module() reads the live table, not the JWT).
--   5. SELECT cases — must return 0 rows (immediate effect, no re-login needed).
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: paralegal sees 1 case (before revocation)
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f9000000-0000-0000-0000-000000i00600',
  'role',      'authenticated',
  'org_id',    'f9000000-0000-0000-0000-000000i00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T13a: before revocation — paralegal sees 1 case
select results_eq(
  $$ select count(*)::bigint from public.cases $$,
  $$ values (1::bigint) $$,
  'T13a: paralegal with cases module sees 1 case before revocation'
);

-- Step 2: reset to postgres and DELETE the module row
set local role postgres;
delete from public.employee_module_permissions
 where staff_id  = 'f9000000-0000-0000-0000-000000i00600'::uuid
   and module_key = 'cases';

-- Step 3: re-set role to authenticated with the SAME JWT claims (no re-login)
-- has_module() re-evaluates the table on every statement — this is the InitPlan
-- semantics of (select has_module('cases', false)) in the policy USING expression.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f9000000-0000-0000-0000-000000i00600',
  'role',      'authenticated',
  'org_id',    'f9000000-0000-0000-0000-000000i00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T13b: confirm the module row is gone (visible as postgres; checked after reset)
-- We can read employee_module_permissions as paralegal: SELECT policy is
-- staff_id = auth.uid() OR is_admin() — paralegal reads their OWN rows.
select results_eq(
  $$ select count(*)::bigint from public.employee_module_permissions
     where module_key = 'cases' $$,
  $$ values (0::bigint) $$,
  'T13b: cases module row has been deleted (0 own emp_module rows for cases)'
);

-- T13c: NEXT statement after revocation — paralegal sees 0 cases (no re-login needed)
select is_empty(
  $$ select id from public.cases $$,
  'T13c: after revocation paralegal sees 0 cases on next statement (RF-ADM-045 immediate effect)'
);

-- T13d: paralegal cannot INSERT a case after revocation (42501)
select throws_ok(
  $$ insert into public.cases
       (id, org_id, case_number, service_id, service_plan_id, primary_client_id)
     values (
       'f9000000-0000-0000-0000-000000i00e00'::uuid,
       'f9000000-0000-0000-0000-000000i00100'::uuid,
       'T9-REVOKED-1',
       'f9000000-0000-0000-0000-000000i00800'::uuid,
       'f9000000-0000-0000-0000-000000i00a00'::uuid,
       'f9000000-0000-0000-0000-000000i00700'::uuid
     ) $$,
  '42501',
  null,
  'T13d: after cases module revocation, paralegal cannot INSERT a case'
);

select * from finish();
rollback;
