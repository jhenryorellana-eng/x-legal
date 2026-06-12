-- =============================================================================
-- 01_client_isolation.sql
-- DOC-31 §8.2 — Test 1
--
-- Asserts: Client A cannot SELECT cases or case_documents belonging to
-- Client B. The gate is case_members: a client only sees cases where
-- they have a row in case_members, and child tables inherit via
-- is_case_member(case_id).
--
-- Fixtures (created inside the transaction, no seeds dependency):
--   Org O1 (uuid ending …a001)
--   Service + plan + phase (minimum required by cases FK chain)
--   Client A (…a002) — member of Case A (…a004)
--   Client B (…a003) — member of Case B (…a005)
--   One case_document per case
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

-- ── UUIDs used in this test ──────────────────────────────────────────────────
\set org_id     '''f1000000-0000-0000-0000-000000a00100'''
\set client_a   '''f1000000-0000-0000-0000-000000a00200'''
\set client_b   '''f1000000-0000-0000-0000-000000a00300'''
\set case_a_id  '''f1000000-0000-0000-0000-000000a00400'''
\set case_b_id  '''f1000000-0000-0000-0000-000000a00500'''
\set doc_a_id   '''f1000000-0000-0000-0000-000000a00600'''
\set doc_b_id   '''f1000000-0000-0000-0000-000000a00700'''
\set service_id '''f1000000-0000-0000-0000-000000a00800'''
\set plan_id    '''f1000000-0000-0000-0000-000000a00900'''
\set phase_id   '''f1000000-0000-0000-0000-000000a00a00'''

-- ── Fixtures (running as postgres = bypass RLS) ───────────────────────────────

-- auth.users — minimum columns + token columns normalized to '' (GoTrue requirement)
insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:client_a::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_a_t1@test.invalid', now(), now(),
   '', '', '', '', '', '', '', ''),
  (:client_b::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_b_t1@test.invalid', now(), now(),
   '', '', '', '', '', '', '', '');

-- org
insert into public.orgs (id, name)
values (:org_id::uuid, 'TestOrg_T1');

-- public.users
insert into public.users (id, org_id, kind, is_active)
values
  (:client_a::uuid, :org_id::uuid, 'client', true),
  (:client_b::uuid, :org_id::uuid, 'client', true);

-- service catalog skeleton — real schema: slug NOT NULL, category NOT NULL, label_i18n (not name_i18n)
insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t1', 'migratorio',
        '{"es":"Servicio Test","en":"Test Service"}'::jsonb, true);

-- service_phases — real schema: slug NOT NULL, label_i18n (not name_i18n), position NOT NULL
insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t1',
        '{"es":"Fase 1","en":"Phase 1"}'::jsonb, 1);

-- service_plans — real schema: kind ('self'|'with_lawyer') NOT NULL, price_cents integer (not price numeric+currency)
insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, 'self', 10000, 'USD', true);

-- cases
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_a_id::uuid, :org_id::uuid, 'T1-CASE-A', :service_id::uuid, :plan_id::uuid,
   :client_a::uuid, 'active'),
  (:case_b_id::uuid, :org_id::uuid, 'T1-CASE-B', :service_id::uuid, :plan_id::uuid,
   :client_b::uuid, 'active');

-- case_members: A owns case_a, B owns case_b — no cross-membership
insert into public.case_members (case_id, user_id, access_role)
values
  (:case_a_id::uuid, :client_a::uuid, 'owner'),
  (:case_b_id::uuid, :client_b::uuid, 'owner');

-- case_documents: one per case
insert into public.case_documents
  (id, case_id, uploaded_by, storage_path, original_filename, mime_type, size_bytes)
values
  (:doc_a_id::uuid, :case_a_id::uuid, :client_a::uuid,
   'case/f1000000-0000-0000-0000-000000a00400/doc_a.pdf', 'doc_a.pdf', 'application/pdf', 1024),
  (:doc_b_id::uuid, :case_b_id::uuid, :client_b::uuid,
   'case/f1000000-0000-0000-0000-000000a00500/doc_b.pdf', 'doc_b.pdf', 'application/pdf', 1024);

-- ── Helper: set JWT claims for client A ──────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1000000-0000-0000-0000-000000a00200',
  'role',      'authenticated',
  'org_id',    'f1000000-0000-0000-0000-000000a00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

-- T1a: client A sees exactly 1 case (their own)
select results_eq(
  $$ select count(*)::bigint from public.cases $$,
  $$ values (1::bigint) $$,
  'T1: client A sees exactly 1 case (their own)'
);

-- T1b: client A cannot see case_b by id
select is_empty(
  $$ select id from public.cases where id = 'f1000000-0000-0000-0000-000000a00500'::uuid $$,
  'T1: client A gets zero rows when querying case_b directly'
);

-- T1c: client A sees exactly 1 case_document
select results_eq(
  $$ select count(*)::bigint from public.case_documents $$,
  $$ values (1::bigint) $$,
  'T1: client A sees exactly 1 case_document (their own)'
);

-- T1d: client A cannot see doc_b
select is_empty(
  $$ select id from public.case_documents where id = 'f1000000-0000-0000-0000-000000a00700'::uuid $$,
  'T1: client A gets zero rows when querying doc_b directly'
);

-- ── Switch to client B ────────────────────────────────────────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1000000-0000-0000-0000-000000a00300',
  'role',      'authenticated',
  'org_id',    'f1000000-0000-0000-0000-000000a00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

-- T1e: client B sees exactly 1 case (their own, not A's)
select results_eq(
  $$ select count(*)::bigint from public.cases $$,
  $$ values (1::bigint) $$,
  'T1: client B sees exactly 1 case (their own, not A s)'
);

-- T1f: client B cannot see case_a
select is_empty(
  $$ select id from public.cases where id = 'f1000000-0000-0000-0000-000000a00400'::uuid $$,
  'T1: client B gets zero rows when querying case_a directly'
);

select * from finish();
rollback;
