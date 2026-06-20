-- =============================================================================
-- 21_storage_bucket_policies.sql
-- DOC-31 §8.2 — Test 29
--
-- Asserts the storage.objects policies for the two most sensitive buckets
-- (0014_storage_buckets.sql). Buckets are created by migration 0014 and persist
-- across the test transaction; we insert/select our own objects (scoped by a
-- unique path prefix) and roll back.
--
--   case-documents (path: case/{case_id}/…  → segment[2] = case_id):
--     SELECT: is_case_member(segment[2]) OR has_module('cases', false)
--     INSERT: is_case_member(segment[2]) OR has_module('cases', true)
--   → A client SELECTs/INSERTs only objects whose path case_id is THEIR case.
--     A path carrying ANOTHER case's id is denied (cross-case path forgery).
--
--   expedientes (client NEVER reads, DOC-30 §8):
--     SELECT: has_module('expedientes'|'printing'|'validations', false)
--   → A client sees 0 objects; INSERT has no authenticated policy at all.
--
-- All assertions are scoped to the test path prefix so unrelated objects (seeds)
-- do not interfere.
--
-- Fixtures (prefix f21…, own transaction):
--   Org O21 (…200100)
--   client_a (…200200) — member of Case A (…200400)
--   client_b (…200300) — member of Case B (…200500), NOT a member of Case A
--   service → phase → plan skeleton
--   storage object on case-documents for Case A (postgres-inserted)
--   storage object on expedientes for Case A (postgres-inserted)
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id      '''f2100000-0000-0000-0000-000002200100'''
\set client_a    '''f2100000-0000-0000-0000-000002200200'''
\set client_b    '''f2100000-0000-0000-0000-000002200300'''
\set case_a_id   '''f2100000-0000-0000-0000-000002200400'''
\set case_b_id   '''f2100000-0000-0000-0000-000002200500'''
\set service_id  '''f2100000-0000-0000-0000-000002200600'''
\set plan_id     '''f2100000-0000-0000-0000-000002200700'''
\set phase_id    '''f2100000-0000-0000-0000-000002200800'''

-- ── Fixtures (postgres = bypass RLS) ──────────────────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:client_a::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_a_t21@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:client_b::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_b_t21@test.invalid', now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T21');

insert into public.users (id, org_id, kind, is_active) values
  (:client_a::uuid, :org_id::uuid, 'client', true),
  (:client_b::uuid, :org_id::uuid, 'client', true);

insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t21', 'migratorio',
        '{"es":"Svc T21","en":"Svc T21"}'::jsonb, true);
insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t21',
        '{"es":"Fase","en":"Phase"}'::jsonb, 1);
insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, 'self', 10000, 'USD', true);

insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_a_id::uuid, :org_id::uuid, 'T21-CASE-A', :service_id::uuid, :plan_id::uuid,
   :client_a::uuid, 'active'),
  (:case_b_id::uuid, :org_id::uuid, 'T21-CASE-B', :service_id::uuid, :plan_id::uuid,
   :client_b::uuid, 'active');

insert into public.case_members (case_id, user_id, access_role) values
  (:case_a_id::uuid, :client_a::uuid, 'owner'),
  (:case_b_id::uuid, :client_b::uuid, 'owner');

-- storage objects inserted as postgres (service_role equivalent).
-- case-documents object for Case A:
insert into storage.objects (bucket_id, name)
values ('case-documents', 'case/f2100000-0000-0000-0000-000002200400/t21-doc-a.pdf');
-- expedientes object for Case A (client must NEVER see it):
insert into storage.objects (bucket_id, name)
values ('expedientes', 'case/f2100000-0000-0000-0000-000002200400/t21-exp-a-v1.pdf');

-- ── Act as Client A (member of Case A) ───────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f2100000-0000-0000-0000-000002200200',
  'role',      'authenticated',
  'org_id',    'f2100000-0000-0000-0000-000002200100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

-- T29a: client A SELECTs the case-documents object of THEIR case (path case_id = Case A)
select results_eq(
  $$ select count(*)::bigint from storage.objects
     where bucket_id = 'case-documents'
       and name = 'case/f2100000-0000-0000-0000-000002200400/t21-doc-a.pdf' $$,
  $$ values (1::bigint) $$,
  'T29a: client A can SELECT a case-documents object on their own case path'
);

-- T29b: client A CAN INSERT into case-documents under their own case path
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('case-documents', 'case/f2100000-0000-0000-0000-000002200400/t21-upload-a.pdf') $$,
  'T29b: client A CAN INSERT a case-documents object on their own case path'
);

-- T29c: client A cannot INSERT a case-documents object under ANOTHER case path (Case B) → 42501
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('case-documents', 'case/f2100000-0000-0000-0000-000002200500/t21-spoof.pdf') $$,
  '42501',
  null,
  'T29c: client A cannot INSERT a case-documents object on another case path'
);

-- T29d: client A cannot SELECT a case-documents object on another case path
--       (we insert it as postgres first, then assert 0 rows as the client)
set local role postgres;
insert into storage.objects (bucket_id, name)
values ('case-documents', 'case/f2100000-0000-0000-0000-000002200500/t21-doc-b.pdf');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f2100000-0000-0000-0000-000002200200',
  'role',      'authenticated',
  'org_id',    'f2100000-0000-0000-0000-000002200100',
  'user_kind', 'client',
  'user_role', null
)::text, true);
select is_empty(
  $$ select id from storage.objects
     where bucket_id = 'case-documents'
       and name = 'case/f2100000-0000-0000-0000-000002200500/t21-doc-b.pdf' $$,
  'T29d: client A cannot SELECT a case-documents object on another case path'
);

-- T29e: client A sees 0 objects in the expedientes bucket (client never reads it)
select is_empty(
  $$ select id from storage.objects
     where bucket_id = 'expedientes'
       and name like 'case/f2100000-0000-0000-0000-000002200400/%' $$,
  'T29e: client A sees 0 expedientes storage objects (compiled files hidden)'
);

-- T29f: client A cannot INSERT into the expedientes bucket (no authenticated INSERT policy) → 42501
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('expedientes', 'case/f2100000-0000-0000-0000-000002200400/t21-client-exp.pdf') $$,
  '42501',
  null,
  'T29f: client cannot INSERT into expedientes bucket (service_role-only writes)'
);

select * from finish();
rollback;
