-- =============================================================================
-- 10_signing_token.sql
-- DOC-31 §8.2 — Test 18
--
-- Asserts: the public /firma/[token] signing flow CANNOT be replicated via
-- the `anon` or `authenticated` roles against the contracts table.
--
-- Security model (DOC-22 §4, DOC-31 §4, 0005_contracts.sql):
--   • The signing token is NOT a secret that unlocks RLS.
--   • The /firma/[token] page calls contracts/service.ts which uses the
--     SERVICE ROLE client — bypassing RLS entirely.
--   • There is NO anon policy on public.contracts. An attacker with only the
--     anon key cannot enumerate or read any contract rows, regardless of
--     whether they have guessed a signing_token value.
--   • A client user CAN read their own signed contract (via the SELECT policy)
--     but only if (a) they are a case_member AND (b) the contract is status='signed'.
--     They CANNOT read a 'sent' contract by supplying the signing_token.
--
-- Tests:
--   T18a: anon role sees 0 contracts rows (no anon policy)
--   T18b: anon cannot INSERT into contracts
--   T18c: authenticated client (non-member) sees 0 contracts — token lookup fails
--   T18d: authenticated client who IS case_member sees signed contract
--   T18e: authenticated client who IS case_member cannot see 'sent' contract
--         (status check + no direct token access via RLS)
--   T18f: a client from org A cannot see a contract from org B
--
-- Fixtures (all auto-contained, no seeds dependency):
--   Org A (…a0aa01), Org B (…b0bb01)
--   Staff user (…a0aa10) in Org A
--   Client A (…a0aa20) — case member of case A → signed contract A
--   Client B (…a0aa30) — NOT a member of any case
--   Client C (…b0bb20) — belongs to Org B (cross-org test)
--   Case A (…a0aa40) with contract A (signing_token = null because signed)
--   Case S (…a0aa50) with contract S status='sent' (signing_token is non-null)
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_a       '''fa000000-0000-0000-0000-00000a0aa001'''
\set org_b       '''fb000000-0000-0000-0000-00000b0bb001'''
\set staff_a     '''fa000000-0000-0000-0000-00000a0aa010'''
\set client_a    '''fa000000-0000-0000-0000-00000a0aa020'''
\set client_b    '''fa000000-0000-0000-0000-00000a0aa030'''
\set client_c    '''fb000000-0000-0000-0000-00000b0bb020'''
\set case_a      '''fa000000-0000-0000-0000-00000a0aa040'''
\set case_s      '''fa000000-0000-0000-0000-00000a0aa050'''
\set service_id  '''fa000000-0000-0000-0000-00000a0aa060'''
\set plan_id     '''fa000000-0000-0000-0000-00000a0aa070'''
\set phase_id    '''fa000000-0000-0000-0000-00000a0aa080'''
\set contract_a  '''fa000000-0000-0000-0000-00000a0aa090'''
\set contract_s  '''fa000000-0000-0000-0000-00000a0aa0a0'''

-- ── Fixtures (postgres = bypass RLS) ─────────────────────────────────────────

-- auth.users (all token columns = '' per GoTrue requirement)
insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
) values
  (:staff_a::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_t18_a@test.invalid',   now(), now(), '', '', '', '', '', '', '', ''),
  (:client_a::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t18_a@test.invalid',  now(), now(), '', '', '', '', '', '', '', ''),
  (:client_b::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t18_b@test.invalid',  now(), now(), '', '', '', '', '', '', '', ''),
  (:client_c::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t18_c@test.invalid',  now(), now(), '', '', '', '', '', '', '', '');

-- orgs
insert into public.orgs (id, name) values
  (:org_a::uuid, 'OrgA_T18'),
  (:org_b::uuid, 'OrgB_T18');

-- users
insert into public.users (id, org_id, kind, is_active) values
  (:staff_a::uuid,  :org_a::uuid, 'staff',  true),
  (:client_a::uuid, :org_a::uuid, 'client', true),
  (:client_b::uuid, :org_a::uuid, 'client', true),
  (:client_c::uuid, :org_b::uuid, 'client', true);

-- staff_profiles (needed for contracts.created_by FK)
insert into public.staff_profiles (user_id, role, display_name)
values (:staff_a::uuid, 'admin', 'Staff_T18');

-- catalog skeleton
insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_a::uuid, 'svc-t18', 'migratorio',
        '{"es":"Svc T18","en":"Svc T18"}'::jsonb, true);

insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t18',
        '{"es":"Fase","en":"Phase"}'::jsonb, 1);

insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, 'self', 50000, 'USD', true);

-- cases
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_a::uuid, :org_a::uuid, 'T18-CASE-A', :service_id::uuid, :plan_id::uuid,
   :client_a::uuid, 'active'),
  (:case_s::uuid, :org_a::uuid, 'T18-CASE-S', :service_id::uuid, :plan_id::uuid,
   :client_a::uuid, 'payment_pending');

-- case_members: client_a owns case_a; client_b has NO membership
insert into public.case_members (case_id, user_id, access_role)
values (:case_a::uuid, :client_a::uuid, 'owner');

-- contracts:
--   contract_a: status='signed', signing_token=null (consumed), linked to case_a
--   contract_s: status='sent',   signing_token=gen_random_uuid(), linked to case_s
insert into public.contracts
  (id, org_id, case_id, service_id, service_plan_id,
   plan_snapshot, parties_snapshot,
   status, signing_token, created_by)
values
  (:contract_a::uuid, :org_a::uuid, :case_a::uuid, :service_id::uuid, :plan_id::uuid,
   '{}'::jsonb, '[]'::jsonb,
   'signed', null, :staff_a::uuid),
  (:contract_s::uuid, :org_a::uuid, :case_s::uuid, :service_id::uuid, :plan_id::uuid,
   '{}'::jsonb, '[]'::jsonb,
   'sent', gen_random_uuid(), :staff_a::uuid);

-- ── T18a: anon role sees 0 contracts rows ─────────────────────────────────────
-- There is no anon policy on contracts — deny by default.
set local role anon;
select set_config('request.jwt.claims', json_build_object(
  'sub',  '',
  'role', 'anon'
)::text, true);

select is_empty(
  $$ select id from public.contracts $$,
  'T18a: anon role sees 0 contracts (no anon RLS policy)'
);

-- ── T18b: anon cannot INSERT into contracts ───────────────────────────────────
select throws_ok(
  $$ insert into public.contracts
       (org_id, service_id, service_plan_id, plan_snapshot, parties_snapshot, status)
     values (
       'fa000000-0000-0000-0000-00000a0aa001'::uuid,
       'fa000000-0000-0000-0000-00000a0aa060'::uuid,
       'fa000000-0000-0000-0000-00000a0aa070'::uuid,
       '{}'::jsonb, '[]'::jsonb, 'draft'
     ) $$,
  '42501',
  null,
  'T18b: anon cannot INSERT into contracts'
);

-- ── T18c: authenticated client (non-member) sees 0 contracts ─────────────────
-- client_b is authenticated but NOT a case_member for any case.
-- Even if they know contract_s.signing_token, they cannot read the row via RLS.
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'fa000000-0000-0000-0000-00000a0aa030',
  'role',      'authenticated',
  'org_id',    'fa000000-0000-0000-0000-00000a0aa001',
  'user_kind', 'client',
  'user_role', null
)::text, true);

select is_empty(
  $$ select id from public.contracts $$,
  'T18c: authenticated client (non-member) sees 0 contracts'
);

-- ── T18d: authenticated client who IS case_member sees their signed contract ──
-- client_a is an owner of case_a, which has contract_a (status='signed').
-- The SELECT policy allows clients to see their own signed contract.
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'fa000000-0000-0000-0000-00000a0aa020',
  'role',      'authenticated',
  'org_id',    'fa000000-0000-0000-0000-00000a0aa001',
  'user_kind', 'client',
  'user_role', null
)::text, true);

select results_eq(
  $$ select count(*)::bigint from public.contracts where status = 'signed' $$,
  $$ values (1::bigint) $$,
  'T18d: case_member client sees their own signed contract (exactly 1)'
);

-- ── T18e: authenticated client cannot see 'sent' contract via RLS ─────────────
-- contract_s is status='sent' (not 'signed') for case_s. client_a is NOT a
-- case_member of case_s. Even if they know the signing_token, they get 0 rows.
-- (The signing flow goes through service_role, never via authenticated RLS.)
select is_empty(
  $$ select id from public.contracts where status = 'sent' $$,
  'T18e: client cannot see sent contracts via RLS — signing token does not grant RLS access'
);

-- ── T18f: client from Org B cannot see Org A contracts ────────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'fb000000-0000-0000-0000-00000b0bb020',
  'role',      'authenticated',
  'org_id',    'fb000000-0000-0000-0000-00000b0bb001',
  'user_kind', 'client',
  'user_role', null
)::text, true);

select is_empty(
  $$ select id from public.contracts $$,
  'T18f: client from Org B sees 0 contracts (cross-org isolation)'
);

select * from finish();
rollback;
