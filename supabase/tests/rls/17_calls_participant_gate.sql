-- =============================================================================
-- 17_calls_participant_gate.sql
-- DOC-31 §8.2 — Test 23
--
-- Asserts the calls policies (0010_messaging.sql, DOC-25 §2.3):
--
--   calls_select: is_conversation_participant(conversation_id) OR is_admin()
--   calls_insert: is_conversation_participant(conversation_id)
--                 AND started_by = auth.uid() AND status = 'ringing'
--   calls_update: is_conversation_participant(conversation_id)
--   DELETE: no policy → denied
--
-- Key properties:
--   • A NON-participant cannot INSERT a call into a thread they are not in (42501).
--   • A participant CAN start a call as themselves with status='ringing'.
--   • A participant cannot spoof started_by to another user (42501).
--   • A participant cannot INSERT a call already in status='answered' (insert
--     requires status='ringing'; the final truth is set by the LiveKit webhook
--     with service_role — DOC-25 §3).
--   • A non-participant sees 0 calls.
--
-- Fixtures (prefix f17…, own transaction):
--   Org O17 (…d00100)
--   service → phase → plan → case skeleton
--   client_part (…d00200) — participant
--   staff_part  (…d00300) — paralegal, participant
--   outsider    (…d00400) — client, NOT a participant
--   Conversation (…d00500); participants: client_part, staff_part
--   existing call (…d00600) inserted by postgres (started by staff_part)
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id      '''f1700000-0000-0000-0000-00000dd00100'''
\set client_part '''f1700000-0000-0000-0000-00000dd00200'''
\set staff_part  '''f1700000-0000-0000-0000-00000dd00300'''
\set outsider    '''f1700000-0000-0000-0000-00000dd00400'''
\set conv_id     '''f1700000-0000-0000-0000-00000dd00500'''
\set call_id     '''f1700000-0000-0000-0000-00000dd00600'''
\set case_id     '''f1700000-0000-0000-0000-00000dd00700'''
\set service_id  '''f1700000-0000-0000-0000-00000dd00800'''
\set plan_id     '''f1700000-0000-0000-0000-00000dd00900'''
\set phase_id    '''f1700000-0000-0000-0000-00000dd00a00'''

-- ── Fixtures (postgres = bypass RLS) ──────────────────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:client_part::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_part_t17@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_part::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_part_t17@test.invalid',  now(), now(), '', '', '', '', '', '', '', ''),
  (:outsider::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'outsider_t17@test.invalid',    now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T17');

insert into public.users (id, org_id, kind, is_active) values
  (:client_part::uuid, :org_id::uuid, 'client', true),
  (:staff_part::uuid,  :org_id::uuid, 'staff',  true),
  (:outsider::uuid,    :org_id::uuid, 'client', true);

insert into public.staff_profiles (user_id, role, display_name)
values (:staff_part::uuid, 'paralegal', 'PartParalegal_T17');

insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t17', 'migratorio',
        '{"es":"Svc T17","en":"Svc T17"}'::jsonb, true);
insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t17',
        '{"es":"Fase","en":"Phase"}'::jsonb, 1);
insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, 'self', 10000, 'USD', true);

insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T17-CASE-1', :service_id::uuid, :plan_id::uuid,
   :client_part::uuid, 'active');

insert into public.conversations (id, org_id, scope, case_id, title, last_message_at)
values (:conv_id::uuid, :org_id::uuid, 'case', :case_id::uuid, 'T17 Thread', now());

insert into public.conversation_participants (conversation_id, user_id) values
  (:conv_id::uuid, :client_part::uuid),
  (:conv_id::uuid, :staff_part::uuid);

-- existing call started by staff_part (inserted by postgres = service_role equiv)
insert into public.calls (id, conversation_id, livekit_room, kind, status, started_by, started_at)
values (:call_id::uuid, :conv_id::uuid, 'room-t17', 'video', 'ended',
        :staff_part::uuid, now());

-- ── (1) Outsider (non-participant) — sees 0 calls, cannot INSERT ──────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1700000-0000-0000-0000-00000dd00400',
  'role',      'authenticated',
  'org_id',    'f1700000-0000-0000-0000-00000dd00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

select is_empty(
  $$ select id from public.calls $$,
  'T23a: non-participant outsider sees 0 calls'
);

select throws_ok(
  $$ insert into public.calls
       (conversation_id, livekit_room, kind, status, started_by, started_at)
     values (
       'f1700000-0000-0000-0000-00000dd00500'::uuid,
       'room-intruder', 'video', 'ringing',
       'f1700000-0000-0000-0000-00000dd00400'::uuid, now()
     ) $$,
  '42501',
  null,
  'T23b: non-participant cannot INSERT a call into a thread they are not in'
);

-- ── (2) Participant client — can start a call as themselves (ringing) ─────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1700000-0000-0000-0000-00000dd00200',
  'role',      'authenticated',
  'org_id',    'f1700000-0000-0000-0000-00000dd00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

select lives_ok(
  $$ insert into public.calls
       (conversation_id, livekit_room, kind, status, started_by, started_at)
     values (
       'f1700000-0000-0000-0000-00000dd00500'::uuid,
       'room-client-start', 'video', 'ringing',
       'f1700000-0000-0000-0000-00000dd00200'::uuid, now()
     ) $$,
  'T23c: participant CAN start a call as themselves with status=ringing'
);

-- T23d: participant cannot spoof started_by to another user (42501)
select throws_ok(
  $$ insert into public.calls
       (conversation_id, livekit_room, kind, status, started_by, started_at)
     values (
       'f1700000-0000-0000-0000-00000dd00500'::uuid,
       'room-spoof', 'video', 'ringing',
       'f1700000-0000-0000-0000-00000dd00300'::uuid, now()
     ) $$,
  '42501',
  null,
  'T23d: participant cannot INSERT a call with started_by = another user'
);

-- T23e: participant cannot INSERT a call already in status='active'
--       (insert RLS WITH CHECK requires status='ringing'; 'active' is a valid
--       status per the table CHECK, so the failure is the RLS 42501, not 23514)
select throws_ok(
  $$ insert into public.calls
       (conversation_id, livekit_room, kind, status, started_by, started_at)
     values (
       'f1700000-0000-0000-0000-00000dd00500'::uuid,
       'room-active', 'video', 'active',
       'f1700000-0000-0000-0000-00000dd00200'::uuid, now()
     ) $$,
  '42501',
  null,
  'T23e: participant cannot INSERT a call with status != ringing'
);

-- T23f (positive): participant sees the calls of their thread
select results_eq(
  $$ select count(*)::bigint from public.calls $$,
  $$ values (2::bigint) $$,
  'T23f: participant client sees the calls of their conversation (existing + own)'
);

select * from finish();
rollback;
