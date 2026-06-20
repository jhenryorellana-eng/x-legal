-- =============================================================================
-- 12_messaging_participant_isolation.sql
-- DOC-31 §8.2 — Messaging participant isolation (F7-Ola7a)
--
-- Asserts the RLS contract of block 10 (0010_messaging.sql):
--   • SELECT on conversations/messages is gated by is_conversation_participant()
--     (or is_admin()). A non-participant staff WITHOUT admin sees nothing, even
--     with case access elsewhere.
--   • A different-case client (outsider) sees nothing.
--   • messages INSERT: only a participant, only sender = auth.uid(), only
--     kind in ('text','attachment'). kind='system' and sender-spoofing are
--     blocked (42501).
--   • messages UPDATE/DELETE by authenticated: no policy => 0 rows (immutable).
--   • admin override: an admin who is NOT a participant still reads the thread.
--
-- Fixtures (created inside the transaction, no seeds dependency):
--   Org O12 (…d001)
--   service → phase → plan (cases FK chain)
--   Case (…d006), primary client = client_part
--   client_part (…d002)  — participant (case client)
--   staff_part  (…d003)  — paralegal, messaging edit, participant
--   staff_fin   (…d004)  — finance, NO messaging module, NOT a participant
--   outsider    (…d005)  — client of nothing, NOT a participant
--   staff_admin (…d00b)  — admin, NOT a participant (override read)
--   Conversation (…d007) scope='case'; participants: client_part + staff_part
--   2 messages: one from staff_part, one from client_part
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id      '''f7000000-0000-0000-0000-000000d00100'''
\set client_part '''f7000000-0000-0000-0000-000000d00200'''
\set staff_part  '''f7000000-0000-0000-0000-000000d00300'''
\set staff_fin   '''f7000000-0000-0000-0000-000000d00400'''
\set outsider    '''f7000000-0000-0000-0000-000000d00500'''
\set case_id     '''f7000000-0000-0000-0000-000000d00600'''
\set conv_id     '''f7000000-0000-0000-0000-000000d00700'''
\set service_id  '''f7000000-0000-0000-0000-000000d00800'''
\set plan_id     '''f7000000-0000-0000-0000-000000d00900'''
\set phase_id    '''f7000000-0000-0000-0000-000000d00a00'''
\set staff_admin '''f7000000-0000-0000-0000-000000d00b00'''
\set msg_staff   '''f7000000-0000-0000-0000-000000d00c00'''
\set msg_client  '''f7000000-0000-0000-0000-000000d00d00'''

-- ── Fixtures (running as postgres = bypass RLS) ───────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:client_part::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_part_t12@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_part::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_part_t12@test.invalid',  now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_fin::uuid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_fin_t12@test.invalid',   now(), now(), '', '', '', '', '', '', '', ''),
  (:outsider::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'outsider_t12@test.invalid',    now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_admin::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_admin_t12@test.invalid', now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T12');

insert into public.users (id, org_id, kind, is_active) values
  (:client_part::uuid, :org_id::uuid, 'client', true),
  (:staff_part::uuid,  :org_id::uuid, 'staff',  true),
  (:staff_fin::uuid,   :org_id::uuid, 'staff',  true),
  (:outsider::uuid,    :org_id::uuid, 'client', true),
  (:staff_admin::uuid, :org_id::uuid, 'staff',  true);

insert into public.staff_profiles (user_id, role, display_name) values
  (:staff_part::uuid,  'paralegal', 'PartParalegal'),
  (:staff_fin::uuid,   'finance',   'FinanceStaff'),
  (:staff_admin::uuid, 'admin',     'AdminStaff');

-- messaging module: staff_part edits; staff_fin intentionally has NO messaging row
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit)
values (:staff_part::uuid, 'messaging', true, true);

-- service catalog skeleton
insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t12', 'migratorio',
        '{"es":"Svc T12","en":"Svc T12"}'::jsonb, true);
insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t12',
        '{"es":"Fase","en":"Phase"}'::jsonb, 1);
insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, 'self', 10000, 'USD', true);

insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T12-CASE-1', :service_id::uuid, :plan_id::uuid,
   :client_part::uuid, 'active');

-- conversation (case scope) + participants: client_part + staff_part
insert into public.conversations (id, org_id, scope, case_id, title, last_message_at)
values (:conv_id::uuid, :org_id::uuid, 'case', :case_id::uuid, 'T12 Thread', now());

insert into public.conversation_participants (conversation_id, user_id) values
  (:conv_id::uuid, :client_part::uuid),
  (:conv_id::uuid, :staff_part::uuid);

insert into public.messages (id, conversation_id, sender_user_id, kind, body) values
  (:msg_staff::uuid,  :conv_id::uuid, :staff_part::uuid,  'text', 'Hola, soy su paralegal.'),
  (:msg_client::uuid, :conv_id::uuid, :client_part::uuid, 'text', 'Gracias!');

-- ── (1) Participant client: sees the thread + both messages ──────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f7000000-0000-0000-0000-000000d00200',
  'role',      'authenticated',
  'org_id',    'f7000000-0000-0000-0000-000000d00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

select results_eq(
  $$ select count(*)::bigint from public.conversations $$,
  $$ values (1::bigint) $$,
  'T12.1: participant client sees their case conversation'
);
select results_eq(
  $$ select count(*)::bigint from public.messages $$,
  $$ values (2::bigint) $$,
  'T12.2: participant client sees both messages of the thread'
);

-- participant client can send a text message as themselves
select lives_ok(
  $$ insert into public.messages (conversation_id, sender_user_id, kind, body)
     values ('f7000000-0000-0000-0000-000000d00700'::uuid,
             'f7000000-0000-0000-0000-000000d00200'::uuid, 'text', 'Otro mensaje') $$,
  'T12.3: participant client can INSERT a text message as themselves'
);

-- participant client CANNOT insert a system message (kind not allowed for authenticated)
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_user_id, kind, body)
     values ('f7000000-0000-0000-0000-000000d00700'::uuid,
             'f7000000-0000-0000-0000-000000d00200'::uuid, 'system', 'spoof system') $$,
  '42501', null,
  'T12.4: participant client CANNOT INSERT a system message'
);

-- participant client CANNOT spoof another sender
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_user_id, kind, body)
     values ('f7000000-0000-0000-0000-000000d00700'::uuid,
             'f7000000-0000-0000-0000-000000d00300'::uuid, 'text', 'spoof sender') $$,
  '42501', null,
  'T12.5: participant client CANNOT INSERT with another user as sender'
);

-- messages are immutable: UPDATE/DELETE by an authenticated participant affect 0 rows
select is_empty(
  $$ update public.messages set body = 'edited'
       where id = 'f7000000-0000-0000-0000-000000d00d00'::uuid returning id $$,
  'T12.6: participant client UPDATE on a message affects 0 rows (immutable)'
);
select is_empty(
  $$ delete from public.messages
       where id = 'f7000000-0000-0000-0000-000000d00d00'::uuid returning id $$,
  'T12.7: participant client DELETE on a message affects 0 rows (immutable)'
);

-- ── (2) Non-participant staff WITHOUT admin (finance): sees nothing ──────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f7000000-0000-0000-0000-000000d00400',
  'role',      'authenticated',
  'org_id',    'f7000000-0000-0000-0000-000000d00100',
  'user_kind', 'staff',
  'user_role', 'finance'
)::text, true);

select is_empty(
  $$ select id from public.conversations $$,
  'T12.8: non-participant finance staff sees 0 conversations'
);
select is_empty(
  $$ select id from public.messages $$,
  'T12.9: non-participant finance staff sees 0 messages'
);
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_user_id, kind, body)
     values ('f7000000-0000-0000-0000-000000d00700'::uuid,
             'f7000000-0000-0000-0000-000000d00400'::uuid, 'text', 'intruder') $$,
  '42501', null,
  'T12.10: non-participant finance staff CANNOT INSERT a message'
);

-- ── (3) Outsider client (different membership): sees nothing ─────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f7000000-0000-0000-0000-000000d00500',
  'role',      'authenticated',
  'org_id',    'f7000000-0000-0000-0000-000000d00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

select is_empty(
  $$ select id from public.messages $$,
  'T12.11: outsider client sees 0 messages of a thread they are not in'
);

-- ── (4) Admin override: non-participant admin still reads the thread ─────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f7000000-0000-0000-0000-000000d00b00',
  'role',      'authenticated',
  'org_id',    'f7000000-0000-0000-0000-000000d00100',
  'user_kind', 'staff',
  'user_role', 'admin'
)::text, true);

select results_eq(
  $$ select count(*)::bigint from public.conversations $$,
  $$ values (1::bigint) $$,
  'T12.12: non-participant admin reads the conversation (is_admin override)'
);
select results_eq(
  $$ select count(*)::bigint from public.messages $$,
  $$ values (3::bigint) $$,
  'T12.13: non-participant admin reads all messages (is_admin override)'
);

select * from finish();
rollback;
