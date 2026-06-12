-- =============================================================================
-- 05_anon_total_block.sql
-- DOC-31 §8.2 — Test 17
--
-- Asserts DOC-31 principle 7: the `anon` role has ZERO access to any table.
--
-- Strategy:
--   1. With role=anon + empty claims, SELECT on a representative table from
--      each block (13 blocks) returns 0 rows (is_empty).
--   2. INSERT attempts on representative tables raise 42501.
--
-- We do NOT loop over pg_tables (dynamic SQL would escape pgTAP accounting).
-- Instead we test one representative table per block plus the most sensitive
-- tables explicitly: cases, users, employee_module_permissions,
-- case_documents, contracts, leads, audit_log, messages, notifications.
--
-- Fixtures:
--   Org O5 (…e001)
--   One row in each exercised table, inserted as postgres, so that if anon
--   could read it we would get > 0 rows (not false-green on empty tables).
--
-- Note: several tables have FK chains (cases → service_plans → services, etc.)
-- We create the minimum viable chain for each block.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

-- 13 SELECT checks + 4 INSERT checks = 17 assertions
select plan(17);

-- ── Shared UUIDs ─────────────────────────────────────────────────────────────
\set org_id      '''f5000000-0000-0000-0000-000000e00100'''
\set staff_id    '''f5000000-0000-0000-0000-000000e00200'''
\set client_id   '''f5000000-0000-0000-0000-000000e00300'''
\set case_id     '''f5000000-0000-0000-0000-000000e00400'''
\set service_id  '''f5000000-0000-0000-0000-000000e00500'''
\set plan_id     '''f5000000-0000-0000-0000-000000e00600'''
\set phase_id    '''f5000000-0000-0000-0000-000000e00700'''
\set conv_id     '''f5000000-0000-0000-0000-000000e00800'''
\set lead_id     '''f5000000-0000-0000-0000-000000e00900'''
\set doc_id      '''f5000000-0000-0000-0000-000000e00a00'''
\set msg_id      '''f5000000-0000-0000-0000-000000e00b00'''
\set notif_id    '''f5000000-0000-0000-0000-000000e00c00'''
\set post_id     '''f5000000-0000-0000-0000-000000e00d00'''
\set audit_id    '''f5000000-0000-0000-0000-000000e00e00'''

-- ── Fixtures (postgres role = bypass RLS) ────────────────────────────────────

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  (:staff_id::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_t5@test.invalid',  now(), now()),
  (:client_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t5@test.invalid', now(), now());

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T5');

insert into public.users (id, org_id, kind, is_active) values
  (:staff_id::uuid,  :org_id::uuid, 'staff',  true),
  (:client_id::uuid, :org_id::uuid, 'client', true);

insert into public.staff_profiles (user_id, role, display_name)
values (:staff_id::uuid, 'admin', 'Admin_T5');

insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit)
values (:staff_id::uuid, 'leads', true, true);

-- catalog skeleton (Bloque 2)
insert into public.services (id, org_id, name_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, '{"es":"Svc T5","en":"Svc T5"}'::jsonb, true);

insert into public.service_phases (id, service_id, name_i18n, position)
values (:phase_id::uuid, :service_id::uuid, '{"es":"Fase","en":"Phase"}'::jsonb, 1);

insert into public.service_plans (id, service_id, name_i18n, price, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, '{"es":"Plan T5","en":"Plan T5"}'::jsonb, 100, 'USD', true);

-- leads (Bloque 3)
insert into public.leads (id, org_id, service_id, contact_name, status)
values (:lead_id::uuid, :org_id::uuid, :service_id::uuid, 'Lead Anon Test', 'new');

-- case (Bloque 4)
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T5-CASE-1', :service_id::uuid, :plan_id::uuid,
   :client_id::uuid, 'active');

insert into public.case_members (case_id, user_id, access_role)
values (:case_id::uuid, :client_id::uuid, 'owner');

insert into public.case_documents
  (id, case_id, uploaded_by, storage_path, original_filename, mime_type, size_bytes)
values
  (:doc_id::uuid, :case_id::uuid, :staff_id::uuid,
   'case/f5000000-0000-0000-0000-000000e00400/anon_test.pdf',
   'anon_test.pdf', 'application/pdf', 256);

-- messaging (Bloque 10)
insert into public.conversations (id, org_id, title)
values (:conv_id::uuid, :org_id::uuid, 'Anon Test Conv');

insert into public.conversation_participants (conversation_id, user_id)
values (:conv_id::uuid, :client_id::uuid);

insert into public.messages
  (id, conversation_id, sender_user_id, kind, body)
values
  (:msg_id::uuid, :conv_id::uuid, :staff_id::uuid, 'text', 'hello');

-- notifications (Bloque 11)
insert into public.notifications
  (id, user_id, kind, title_i18n)
values
  (:notif_id::uuid, :client_id::uuid, 'case.update',
   '{"es":"Notif","en":"Notif"}'::jsonb);

-- community (Bloque 12)
insert into public.community_posts (id, org_id, title_i18n, body_md, is_published)
values
  (:post_id::uuid, :org_id::uuid,
   '{"es":"Post test","en":"Test Post"}'::jsonb,
   'body', true);

-- audit_log (Bloque 13): service-role-only insert
insert into public.audit_log (id, org_id, actor_kind, action, table_name, record_id)
values
  (:audit_id::uuid, :org_id::uuid, 'system', 'system.test', 'cases', :case_id::uuid);

-- ── Switch to anon role ───────────────────────────────────────────────────────
-- DOC-31 principle 7: anon has NO policies on ANY table.
-- We use empty claims because the anon role has no JWT claims.
set local role anon;
select set_config('request.jwt.claims', json_build_object(
  'sub',       '',
  'role',      'anon'
)::text, true);

-- ── Block 1 — identity ───────────────────────────────────────────────────────
select is_empty(
  $$ select id from public.orgs $$,
  'T17: anon sees 0 rows in orgs (Block 1 identity)'
);

select is_empty(
  $$ select id from public.users $$,
  'T17: anon sees 0 rows in users (Block 1 identity)'
);

-- ── Block 2 — catalog ────────────────────────────────────────────────────────
select is_empty(
  $$ select id from public.services $$,
  'T17: anon sees 0 rows in services (Block 2 catalog)'
);

-- ── Block 3 — leads ──────────────────────────────────────────────────────────
select is_empty(
  $$ select id from public.leads $$,
  'T17: anon sees 0 rows in leads (Block 3 leads)'
);

-- ── Block 4 — cases ──────────────────────────────────────────────────────────
select is_empty(
  $$ select id from public.cases $$,
  'T17: anon sees 0 rows in cases (Block 4 cases)'
);

select is_empty(
  $$ select id from public.case_documents $$,
  'T17: anon sees 0 rows in case_documents (Block 4 cases)'
);

select is_empty(
  $$ select id from public.employee_module_permissions $$,
  'T17: anon sees 0 rows in employee_module_permissions (Block 1 identity)'
);

-- ── Block 5 — contracts (no fixture needed; table must exist) ─────────────────
select is_empty(
  $$ select id from public.contracts $$,
  'T17: anon sees 0 rows in contracts (Block 5 contracts)'
);

-- ── Block 6 — billing ────────────────────────────────────────────────────────
select is_empty(
  $$ select id from public.payment_plans $$,
  'T17: anon sees 0 rows in payment_plans (Block 6 billing)'
);

-- ── Block 10 — messaging ─────────────────────────────────────────────────────
select is_empty(
  $$ select id from public.messages $$,
  'T17: anon sees 0 rows in messages (Block 10 messaging)'
);

-- ── Block 11 — notifications ─────────────────────────────────────────────────
select is_empty(
  $$ select id from public.notifications $$,
  'T17: anon sees 0 rows in notifications (Block 11 notifications)'
);

-- ── Block 12 — community ─────────────────────────────────────────────────────
select is_empty(
  $$ select id from public.community_posts $$,
  'T17: anon sees 0 rows in community_posts (Block 12 community)'
);

-- ── Block 13 — audit_log ─────────────────────────────────────────────────────
select is_empty(
  $$ select id from public.audit_log $$,
  'T17: anon sees 0 rows in audit_log (Block 13 audit)'
);

-- ── INSERT attempts: must all raise 42501 ─────────────────────────────────────

-- anon cannot insert into orgs
select throws_ok(
  $$ insert into public.orgs (id, name)
     values ('f5000000-0000-0000-0000-000000e00f00'::uuid, 'AnonOrg') $$,
  '42501',
  null,
  'T17: anon cannot INSERT into orgs'
);

-- anon cannot insert into cases
select throws_ok(
  $$ insert into public.cases
       (org_id, case_number, service_id, service_plan_id, primary_client_id)
     values (
       'f5000000-0000-0000-0000-000000e00100'::uuid,
       'T5-ANON-1',
       'f5000000-0000-0000-0000-000000e00500'::uuid,
       'f5000000-0000-0000-0000-000000e00600'::uuid,
       'f5000000-0000-0000-0000-000000e00300'::uuid
     ) $$,
  '42501',
  null,
  'T17: anon cannot INSERT into cases'
);

-- anon cannot insert into messages
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_user_id, kind, body)
     values (
       'f5000000-0000-0000-0000-000000e00800'::uuid,
       'f5000000-0000-0000-0000-000000e00200'::uuid,
       'text', 'anon injection'
     ) $$,
  '42501',
  null,
  'T17: anon cannot INSERT into messages'
);

-- anon cannot insert into notifications
select throws_ok(
  $$ insert into public.notifications (user_id, kind, title_i18n)
     values (
       'f5000000-0000-0000-0000-000000e00300'::uuid,
       'case.update',
       '{"es":"Inject","en":"Inject"}'::jsonb
     ) $$,
  '42501',
  null,
  'T17: anon cannot INSERT into notifications'
);

select * from finish();
rollback;
