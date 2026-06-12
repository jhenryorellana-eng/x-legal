-- =============================================================================
-- 02_deactivated_user.sql
-- DOC-31 §8.2 — Tests 10 and 11
--
-- Test 10: Staff user with is_active=false + valid JWT => is_staff() returns
--          false => SELECT on cases yields 0 rows.
-- Test 11: Client user with is_active=false + valid JWT => is_case_member()
--          returns false (live is_active check in helper) => SELECT on
--          cases/case_documents yields 0 rows.
--
-- Both helpers (is_staff, is_client, is_case_member) perform a live JOIN on
-- public.users.is_active, so a JWT that was valid before deactivation no
-- longer grants any data access.
--
-- Fixtures:
--   Org O2 (…b001)
--   Deactivated staff (…b002) — kind=staff, is_active=false
--   Deactivated client (…b003) — kind=client, is_active=false
--   Active staff (…b004) — kind=staff, is_active=true, role=paralegal, cases module
--   Case (…b005) with deactivated client as primary_client_id
--   case_member row linking deactivated client to the case
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id         '''f2000000-0000-0000-0000-000000b00100'''
\set staff_inactive '''f2000000-0000-0000-0000-000000b00200'''
\set client_inactive '''f2000000-0000-0000-0000-000000b00300'''
\set staff_active   '''f2000000-0000-0000-0000-000000b00400'''
\set case_id        '''f2000000-0000-0000-0000-000000b00500'''
\set service_id     '''f2000000-0000-0000-0000-000000b00600'''
\set plan_id        '''f2000000-0000-0000-0000-000000b00700'''
\set phase_id       '''f2000000-0000-0000-0000-000000b00800'''
\set doc_id         '''f2000000-0000-0000-0000-000000b00900'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  (:staff_inactive::uuid, '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'staff_inactive_t2@test.invalid', now(), now()),
  (:client_inactive::uuid, '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'client_inactive_t2@test.invalid', now(), now()),
  (:staff_active::uuid, '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'staff_active_t2@test.invalid', now(), now());

insert into public.orgs (id, name)
values (:org_id::uuid, 'TestOrg_T2');

-- Deactivated staff (is_active=false)
insert into public.users (id, org_id, kind, is_active)
values (:staff_inactive::uuid, :org_id::uuid, 'staff', false);

insert into public.staff_profiles (user_id, role, display_name)
values (:staff_inactive::uuid, 'paralegal', 'InactiveParalegal');

-- Deactivated client (is_active=false)
insert into public.users (id, org_id, kind, is_active)
values (:client_inactive::uuid, :org_id::uuid, 'client', false);

-- Active staff (needed as primary_client_id surrogate; we use it only to own
-- the module permission — actual primary_client_id must be a client kind user;
-- we reuse client_inactive as primary since FK just needs a users.id)
insert into public.users (id, org_id, kind, is_active)
values (:staff_active::uuid, :org_id::uuid, 'staff', true);

insert into public.staff_profiles (user_id, role, display_name)
values (:staff_active::uuid, 'paralegal', 'ActiveParalegal');

-- cases module for active staff
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit)
values (:staff_active::uuid, 'cases', true, true);

-- service catalog skeleton
insert into public.services (id, org_id, name_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, '{"es":"Svc T2","en":"Svc T2"}'::jsonb, true);

insert into public.service_phases (id, service_id, name_i18n, position)
values (:phase_id::uuid, :service_id::uuid, '{"es":"Fase","en":"Phase"}'::jsonb, 1);

insert into public.service_plans (id, service_id, name_i18n, price, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, '{"es":"Plan T2","en":"Plan T2"}'::jsonb, 100, 'USD', true);

-- case (primary_client_id = deactivated client — FK allows any users.id)
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T2-CASE-1', :service_id::uuid, :plan_id::uuid,
   :client_inactive::uuid, 'active');

-- case_member: deactivated client IS linked (membership exists, but is_active=false)
insert into public.case_members (case_id, user_id, access_role)
values (:case_id::uuid, :client_inactive::uuid, 'owner');

-- one document on the case
insert into public.case_documents
  (id, case_id, uploaded_by, storage_path, original_filename, mime_type, size_bytes)
values
  (:doc_id::uuid, :case_id::uuid, :staff_active::uuid,
   'case/f2000000-0000-0000-0000-000000b00500/doc.pdf', 'doc.pdf', 'application/pdf', 512);

-- ── T10: deactivated staff — is_staff() false, 0 cases ───────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f2000000-0000-0000-0000-000000b00200',
  'role',      'authenticated',
  'org_id',    'f2000000-0000-0000-0000-000000b00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T10a: is_staff() returns false for deactivated user
select results_eq(
  $$ select public.is_staff() $$,
  $$ values (false) $$,
  'T10: is_staff() returns false when users.is_active = false'
);

-- T10b: SELECT cases yields 0 rows (has_module uses is_staff internally)
select is_empty(
  $$ select id from public.cases $$,
  'T10: deactivated staff sees 0 cases even with valid staff JWT'
);

-- T10c: SELECT case_documents yields 0 rows
select is_empty(
  $$ select id from public.case_documents $$,
  'T10: deactivated staff sees 0 case_documents'
);

-- ── T11: deactivated client — is_case_member() false, 0 cases ────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f2000000-0000-0000-0000-000000b00300',
  'role',      'authenticated',
  'org_id',    'f2000000-0000-0000-0000-000000b00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

-- T11a: is_case_member returns false (user.is_active=false in JOIN)
select results_eq(
  $$ select public.is_case_member('f2000000-0000-0000-0000-000000b00500'::uuid) $$,
  $$ values (false) $$,
  'T11: is_case_member() returns false when users.is_active = false'
);

-- T11b: SELECT cases yields 0 rows
select is_empty(
  $$ select id from public.cases $$,
  'T11: deactivated client sees 0 cases even with valid client JWT'
);

-- T11c: SELECT case_documents yields 0 rows
select is_empty(
  $$ select id from public.case_documents $$,
  'T11: deactivated client sees 0 case_documents'
);

select * from finish();
rollback;
