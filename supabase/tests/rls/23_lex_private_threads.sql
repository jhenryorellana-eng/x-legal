-- =============================================================================
-- 23_lex_private_threads.sql
-- Lex case chat (0093) — RLS de las 3 tablas del chat IA por caso.
--
-- Security model (0093_lex_case_chat.sql policies):
--
--   case_knowledge_chunks_select:
--     FOR SELECT TO authenticated
--     USING ( (select public.has_module('cases', false)) )
--     → Solo staff con módulo 'cases' (mismo patrón que document_extractions).
--       Un cliente nunca satisface has_module → 0 filas.
--     Sin policy de INSERT/UPDATE/DELETE para authenticated → escritura SOLO
--     service-role (jobs lex-reindex-case). Ni siquiera el staff escribe chunks.
--
--   case_lex_threads_select / _insert:
--     staff_user_id = auth.uid() AND has_module('cases', ...)
--     → Hilo PRIVADO por empleado: otro staff (aun con módulo cases) no lo ve.
--
--   case_lex_messages_select / _insert:
--     EXISTS (thread padre con staff_user_id = auth.uid()) AND has_module(...)
--     → Mensajes solo del dueño del hilo padre.
--
-- Fixtures:
--   Org O23 (…c00100)
--   Client  (…c00200) — case member (owner) del Case (…c00500)
--   Staff A (…c00300) — paralegal, cases can_view+can_edit (dueño del hilo)
--   Staff B (…c00400) — paralegal, cases can_view+can_edit (NO dueño)
--   Service/plan/phase skeleton (…c00600 / …c00700 / …c00800)
--   case_knowledge_chunk (…c00900) — insertado como postgres (service-role equiv.)
--   case_lex_thread de A (…c00a00) + case_lex_message (…c00b00)
--
-- Assertions (plan = 12):
--   Cliente:  a) 0 chunks · b) 0 threads · c) 0 messages · d) INSERT chunk 42501
--   Staff A:  e) ve 1 chunk · f) ve su thread · g) ve su message ·
--             h) INSERT message en su thread OK · i) INSERT chunk 42501
--   Staff B:  j) 0 threads · k) 0 messages · l) INSERT message en thread de A 42501
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

-- ── UUIDs used in this test ──────────────────────────────────────────────────
\set org_id      '''f23c0000-0000-0000-0000-000000c00100'''
\set client_id   '''f23c0000-0000-0000-0000-000000c00200'''
\set staff_a_id  '''f23c0000-0000-0000-0000-000000c00300'''
\set staff_b_id  '''f23c0000-0000-0000-0000-000000c00400'''
\set case_id     '''f23c0000-0000-0000-0000-000000c00500'''
\set service_id  '''f23c0000-0000-0000-0000-000000c00600'''
\set svc_plan_id '''f23c0000-0000-0000-0000-000000c00700'''
\set phase_id    '''f23c0000-0000-0000-0000-000000c00800'''
\set chunk_id    '''f23c0000-0000-0000-0000-000000c00900'''
\set thread_id   '''f23c0000-0000-0000-0000-000000c00a00'''
\set message_id  '''f23c0000-0000-0000-0000-000000c00b00'''

-- ── Fixtures (running as postgres = bypass RLS) ───────────────────────────────

-- auth.users — minimum columns + token columns normalized to '' (GoTrue requirement)
insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:client_id::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t23@test.invalid',  now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_a_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_a_t23@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_b_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_b_t23@test.invalid', now(), now(), '', '', '', '', '', '', '', '');

-- org
insert into public.orgs (id, name)
values (:org_id::uuid, 'TestOrg_T23');

-- public.users
insert into public.users (id, org_id, kind, is_active)
values
  (:client_id::uuid,  :org_id::uuid, 'client', true),
  (:staff_a_id::uuid, :org_id::uuid, 'staff',  true),
  (:staff_b_id::uuid, :org_id::uuid, 'staff',  true);

-- staff_profiles — required by has_module() (employee_module_permissions FK)
insert into public.staff_profiles (user_id, role, display_name)
values
  (:staff_a_id::uuid, 'paralegal', 'LexOwner_T23'),
  (:staff_b_id::uuid, 'paralegal', 'LexOther_T23');

-- employee_module_permissions: BOTH staff have the cases module (view+edit) —
-- proves the thread privacy comes from staff_user_id, not from the module gate.
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit)
values
  (:staff_a_id::uuid, 'cases', true, true),
  (:staff_b_id::uuid, 'cases', true, true);

-- service catalog skeleton
insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t23', 'migratorio',
        '{"es":"Servicio Test 23","en":"Test Service 23"}'::jsonb, true);

insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t23',
        '{"es":"Fase 1","en":"Phase 1"}'::jsonb, 1);

insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:svc_plan_id::uuid, :service_id::uuid, 'self', 10000, 'USD', true);

-- case
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T23-CASE-A', :service_id::uuid, :svc_plan_id::uuid,
   :client_id::uuid, 'active');

-- case_members: client is owner of their case
insert into public.case_members (case_id, user_id, access_role)
values (:case_id::uuid, :client_id::uuid, 'owner');

-- knowledge chunk — written by postgres (service_role equivalent, jobs path)
insert into public.case_knowledge_chunks
  (id, case_id, source_kind, source_id, source_label, chunk_index, content, content_hash)
values
  (:chunk_id::uuid, :case_id::uuid, 'case_profile', :case_id::uuid,
   'Perfil del caso T23-CASE-A', 0, 'Servicio: Asilo. Fase 1.', 'hash-t23');

-- Lex thread of staff A + one message
insert into public.case_lex_threads (id, case_id, staff_user_id)
values (:thread_id::uuid, :case_id::uuid, :staff_a_id::uuid);

insert into public.case_lex_messages (id, thread_id, role, content, status)
values (:message_id::uuid, :thread_id::uuid, 'user', 'Hazme un resumen del caso', 'completed');

-- ── CLIENT: sees nothing, writes nothing ─────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f23c0000-0000-0000-0000-000000c00200',
  'role',      'authenticated',
  'org_id',    'f23c0000-0000-0000-0000-000000c00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

select is_empty(
  $$ select id from public.case_knowledge_chunks $$,
  'T23a: client member sees 0 case_knowledge_chunks (has_module gate)'
);

select is_empty(
  $$ select id from public.case_lex_threads $$,
  'T23b: client member sees 0 case_lex_threads (staff-private work product)'
);

select is_empty(
  $$ select id from public.case_lex_messages $$,
  'T23c: client member sees 0 case_lex_messages (staff-private work product)'
);

select throws_ok(
  $$ insert into public.case_knowledge_chunks
       (case_id, source_kind, source_id, source_label, chunk_index, content, content_hash)
     values (
       'f23c0000-0000-0000-0000-000000c00500'::uuid, 'case_profile',
       'f23c0000-0000-0000-0000-000000c00500'::uuid, 'x', 1, 'x', 'x'
     ) $$,
  '42501',
  null,
  'T23d: client cannot INSERT case_knowledge_chunks (42501 — service-role only)'
);

-- ── STAFF A (thread owner, cases module) — contrast positive ─────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f23c0000-0000-0000-0000-000000c00300',
  'role',      'authenticated',
  'org_id',    'f23c0000-0000-0000-0000-000000c00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

select results_eq(
  $$ select count(*)::bigint from public.case_knowledge_chunks $$,
  $$ values (1::bigint) $$,
  'T23e: staff with cases module sees 1 case_knowledge_chunk (contrast positive)'
);

select results_eq(
  $$ select count(*)::bigint from public.case_lex_threads $$,
  $$ values (1::bigint) $$,
  'T23f: thread owner sees their own case_lex_thread'
);

select results_eq(
  $$ select count(*)::bigint from public.case_lex_messages $$,
  $$ values (1::bigint) $$,
  'T23g: thread owner sees their own case_lex_message'
);

select lives_ok(
  $$ insert into public.case_lex_messages (thread_id, role, content)
     values ('f23c0000-0000-0000-0000-000000c00a00'::uuid, 'user', '¿Qué documentos faltan?') $$,
  'T23h: thread owner CAN insert a message into their own thread'
);

select throws_ok(
  $$ insert into public.case_knowledge_chunks
       (case_id, source_kind, source_id, source_label, chunk_index, content, content_hash)
     values (
       'f23c0000-0000-0000-0000-000000c00500'::uuid, 'case_profile',
       'f23c0000-0000-0000-0000-000000c00500'::uuid, 'y', 2, 'y', 'y'
     ) $$,
  '42501',
  null,
  'T23i: even staff cannot INSERT case_knowledge_chunks (42501 — jobs only)'
);

-- ── STAFF B (cases module, NOT the owner): thread privacy ────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f23c0000-0000-0000-0000-000000c00400',
  'role',      'authenticated',
  'org_id',    'f23c0000-0000-0000-0000-000000c00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

select is_empty(
  $$ select id from public.case_lex_threads $$,
  'T23j: another staff (cases module) sees 0 threads — history is per-employee'
);

select is_empty(
  $$ select id from public.case_lex_messages $$,
  'T23k: another staff (cases module) sees 0 messages of a thread they do not own'
);

select throws_ok(
  $$ insert into public.case_lex_messages (thread_id, role, content)
     values ('f23c0000-0000-0000-0000-000000c00a00'::uuid, 'user', 'intruso') $$,
  '42501',
  null,
  'T23l: another staff cannot INSERT into a thread they do not own (42501)'
);

select * from finish();
rollback;
