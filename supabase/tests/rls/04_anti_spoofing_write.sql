-- =============================================================================
-- 04_anti_spoofing_write.sql
-- DOC-31 §8.2 — Test 14
--
-- Asserts that a client cannot INSERT or UPDATE data attributed to another
-- user (write anti-spoofing):
--
--   (a) Client cannot UPDATE public.cases directly (42501).
--   (b) Client cannot INSERT case_documents with uploaded_by = another user's
--       UUID — the WITH CHECK enforces uploaded_by = auth.uid().
--   (c) Client cannot INSERT case_timeline with actor_user_id = another user's
--       UUID (actor_user_id must equal auth.uid()).
--   (d) Client can INSERT case_documents with uploaded_by = their own UUID
--       (positive path: confirms the policy is correctly scoped, not broken).
--   (e) Client cannot INSERT case_timeline with actor_kind = 'team'
--       (only actor_kind='client' is allowed for the client INSERT policy).
--
-- Fixtures:
--   Org O4 (…d001)
--   Client A (…d002) — member of Case (…d005)
--   Client B (…d003) — NOT a member of Case; used as the spoofing target
--   Active staff (…d004) — used as a second spoofing target
--   Case (…d005) with client_a as primary_client_id
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id    '''f4000000-0000-0000-0000-000000d00100'''
\set client_a  '''f4000000-0000-0000-0000-000000d00200'''
\set client_b  '''f4000000-0000-0000-0000-000000d00300'''
\set staff_id  '''f4000000-0000-0000-0000-000000d00400'''
\set case_id   '''f4000000-0000-0000-0000-000000d00500'''
\set service_id '''f4000000-0000-0000-0000-000000d00600'''
\set plan_id   '''f4000000-0000-0000-0000-000000d00700'''
\set phase_id  '''f4000000-0000-0000-0000-000000d00800'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  (:client_a::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_a_t4@test.invalid', now(), now()),
  (:client_b::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_b_t4@test.invalid', now(), now()),
  (:staff_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_t4@test.invalid',    now(), now());

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T4');

insert into public.users (id, org_id, kind, is_active) values
  (:client_a::uuid, :org_id::uuid, 'client', true),
  (:client_b::uuid, :org_id::uuid, 'client', true),
  (:staff_id::uuid, :org_id::uuid, 'staff',  true);

insert into public.staff_profiles (user_id, role, display_name)
values (:staff_id::uuid, 'paralegal', 'Paralegal_T4');

-- service catalog skeleton
insert into public.services (id, org_id, name_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, '{"es":"Svc T4","en":"Svc T4"}'::jsonb, true);

insert into public.service_phases (id, service_id, name_i18n, position)
values (:phase_id::uuid, :service_id::uuid, '{"es":"Fase","en":"Phase"}'::jsonb, 1);

insert into public.service_plans (id, service_id, name_i18n, price, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, '{"es":"Plan T4","en":"Plan T4"}'::jsonb, 100, 'USD', true);

-- case
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T4-CASE-1', :service_id::uuid, :plan_id::uuid,
   :client_a::uuid, 'active');

-- client_a is a member; client_b is NOT
insert into public.case_members (case_id, user_id, access_role)
values (:case_id::uuid, :client_a::uuid, 'owner');

-- ── Set session as client_a ───────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f4000000-0000-0000-0000-000000d00200',
  'role',      'authenticated',
  'org_id',    'f4000000-0000-0000-0000-000000d00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

-- T14a: client cannot UPDATE cases (no UPDATE policy for clients)
select throws_ok(
  $$ update public.cases set internal_note = 'hacked'
     where id = 'f4000000-0000-0000-0000-000000d00500'::uuid $$,
  '42501',
  null,
  'T14a: client cannot UPDATE cases (no client UPDATE policy)'
);

-- T14b: client cannot INSERT case_documents with uploaded_by = another user
-- The WITH CHECK requires uploaded_by = auth.uid(); using client_b's UUID fails.
select throws_ok(
  $$ insert into public.case_documents
       (case_id, uploaded_by, storage_path, original_filename, mime_type, size_bytes)
     values (
       'f4000000-0000-0000-0000-000000d00500'::uuid,
       'f4000000-0000-0000-0000-000000d00300'::uuid,
       'case/f4000000-0000-0000-0000-000000d00500/spoof.pdf',
       'spoof.pdf', 'application/pdf', 512
     ) $$,
  '42501',
  null,
  'T14b: client cannot INSERT case_documents with uploaded_by = another user'
);

-- T14c: client cannot INSERT case_timeline with actor_user_id = another user
select throws_ok(
  $$ insert into public.case_timeline
       (case_id, event_type, icon, color, title_i18n, actor_kind, actor_user_id, visible_to_client)
     values (
       'f4000000-0000-0000-0000-000000d00500'::uuid,
       'document.uploaded', 'info', 'accent',
       '{"es":"Evento","en":"Event"}'::jsonb,
       'client',
       'f4000000-0000-0000-0000-000000d00300'::uuid,
       true
     ) $$,
  '42501',
  null,
  'T14c: client cannot INSERT case_timeline with actor_user_id = another user'
);

-- T14d (positive): client CAN INSERT case_documents with uploaded_by = own UUID
select lives_ok(
  $$ insert into public.case_documents
       (case_id, uploaded_by, storage_path, original_filename, mime_type, size_bytes)
     values (
       'f4000000-0000-0000-0000-000000d00500'::uuid,
       'f4000000-0000-0000-0000-000000d00200'::uuid,
       'case/f4000000-0000-0000-0000-000000d00500/own.pdf',
       'own.pdf', 'application/pdf', 512
     ) $$,
  'T14d: client CAN INSERT case_documents with their own uploaded_by'
);

-- T14e: client cannot INSERT case_timeline with actor_kind = 'team'
-- (the client INSERT policy requires actor_kind = 'client')
select throws_ok(
  $$ insert into public.case_timeline
       (case_id, event_type, icon, color, title_i18n, actor_kind, actor_user_id, visible_to_client)
     values (
       'f4000000-0000-0000-0000-000000d00500'::uuid,
       'document.uploaded', 'info', 'accent',
       '{"es":"Evento","en":"Event"}'::jsonb,
       'team',
       'f4000000-0000-0000-0000-000000d00200'::uuid,
       true
     ) $$,
  '42501',
  null,
  'T14e: client cannot INSERT case_timeline with actor_kind = team'
);

select * from finish();
rollback;
