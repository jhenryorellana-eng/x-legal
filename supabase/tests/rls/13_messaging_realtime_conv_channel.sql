-- =============================================================================
-- 13_messaging_realtime_conv_channel.sql
-- DOC-31 §8.2 — Realtime conv:{id} channel authorization (F7-Ola7a, DOC-25 §1.3)
--
-- The private channel conv:{conversation_id} is authorized by the policy
-- "rt conv select" on realtime.messages (0015_realtime.sql):
--
--     realtime.topic() like 'conv:%'
--     and public.is_conversation_participant(split_part(realtime.topic(),':',2)::uuid)
--
-- realtime.messages carries no rows outside of live traffic, so the channel
-- predicate cannot be exercised by row visibility in pgTAP. Instead we assert
-- the authorization PREDICATE — public.is_conversation_participant() — under
-- each JWT context. This is the only variable term of the policy (the
-- 'conv:%' prefix and split_part cast are static), and it is the same helper
-- the SELECT subscription check evaluates.
--
-- Key properties asserted:
--   • participant (client and staff)            => true  (may subscribe)
--   • non-participant outsider                   => false (denied)
--   • participant whose user is_active=false     => false (deactivation gate)
--   • admin who is NOT a participant             => false  ← the conv channel
--       has NO is_admin override (unlike messages_select); admins get the
--       REST initial load but degrade to polling on a thread they are not in.
--   • unknown conversation id (deny-by-default)  => false
--   • anon cannot execute the helper at all (grant revoked) => 42501
--
-- Fixtures (prefix f8…, own transaction, no seeds dependency):
--   Org O13 (…e001); service→phase→plan→case
--   client_part (…e002) participant, active
--   staff_part  (…e003) participant, paralegal, active
--   outsider    (…e004) client, active, NOT a participant
--   deact       (…e005) client, participant, is_active=FALSE
--   staff_admin (…e006) admin, NOT a participant
--   Conversation (…e007); participants: client_part, staff_part, deact
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id      '''f8000000-0000-0000-0000-000000e00100'''
\set client_part '''f8000000-0000-0000-0000-000000e00200'''
\set staff_part  '''f8000000-0000-0000-0000-000000e00300'''
\set outsider    '''f8000000-0000-0000-0000-000000e00400'''
\set deact       '''f8000000-0000-0000-0000-000000e00500'''
\set staff_admin '''f8000000-0000-0000-0000-000000e00600'''
\set conv_id     '''f8000000-0000-0000-0000-000000e00700'''
\set case_id     '''f8000000-0000-0000-0000-000000e00800'''
\set service_id  '''f8000000-0000-0000-0000-000000e00900'''
\set plan_id     '''f8000000-0000-0000-0000-000000e00a00'''
\set phase_id    '''f8000000-0000-0000-0000-000000e00b00'''
\set unknown_id  '''f8000000-0000-0000-0000-0000ffffffff'''

-- ── Fixtures (postgres = bypass RLS) ──────────────────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:client_part::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_part_t13@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_part::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_part_t13@test.invalid',  now(), now(), '', '', '', '', '', '', '', ''),
  (:outsider::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'outsider_t13@test.invalid',    now(), now(), '', '', '', '', '', '', '', ''),
  (:deact::uuid,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'deact_t13@test.invalid',       now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_admin::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_admin_t13@test.invalid', now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T13');

insert into public.users (id, org_id, kind, is_active) values
  (:client_part::uuid, :org_id::uuid, 'client', true),
  (:staff_part::uuid,  :org_id::uuid, 'staff',  true),
  (:outsider::uuid,    :org_id::uuid, 'client', true),
  (:deact::uuid,       :org_id::uuid, 'client', false),   -- deactivated participant
  (:staff_admin::uuid, :org_id::uuid, 'staff',  true);

insert into public.staff_profiles (user_id, role, display_name) values
  (:staff_part::uuid,  'paralegal', 'PartParalegal'),
  (:staff_admin::uuid, 'admin',     'AdminStaff');

insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t13', 'migratorio',
        '{"es":"Svc T13","en":"Svc T13"}'::jsonb, true);
insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t13',
        '{"es":"Fase","en":"Phase"}'::jsonb, 1);
insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, 'self', 10000, 'USD', true);

insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T13-CASE-1', :service_id::uuid, :plan_id::uuid,
   :client_part::uuid, 'active');

insert into public.conversations (id, org_id, scope, case_id, title, last_message_at)
values (:conv_id::uuid, :org_id::uuid, 'case', :case_id::uuid, 'T13 Thread', now());

-- deact IS a participant row, but their user is_active=false
insert into public.conversation_participants (conversation_id, user_id) values
  (:conv_id::uuid, :client_part::uuid),
  (:conv_id::uuid, :staff_part::uuid),
  (:conv_id::uuid, :deact::uuid);

-- ── (1) participant client may subscribe ─────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'f8000000-0000-0000-0000-000000e00200', 'role', 'authenticated',
  'org_id', 'f8000000-0000-0000-0000-000000e00100', 'user_kind', 'client', 'user_role', null
)::text, true);
select is(
  public.is_conversation_participant(:conv_id::uuid), true,
  'T13.1: participant client passes the conv:{id} channel predicate'
);

-- ── (2) participant staff may subscribe ──────────────────────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'f8000000-0000-0000-0000-000000e00300', 'role', 'authenticated',
  'org_id', 'f8000000-0000-0000-0000-000000e00100', 'user_kind', 'staff', 'user_role', 'paralegal'
)::text, true);
select is(
  public.is_conversation_participant(:conv_id::uuid), true,
  'T13.2: participant staff passes the conv:{id} channel predicate'
);

-- ── (3) outsider denied ──────────────────────────────────────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'f8000000-0000-0000-0000-000000e00400', 'role', 'authenticated',
  'org_id', 'f8000000-0000-0000-0000-000000e00100', 'user_kind', 'client', 'user_role', null
)::text, true);
select is(
  public.is_conversation_participant(:conv_id::uuid), false,
  'T13.3: non-participant outsider is denied the conv:{id} channel'
);

-- ── (4) deactivated participant denied (is_active gate) ──────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'f8000000-0000-0000-0000-000000e00500', 'role', 'authenticated',
  'org_id', 'f8000000-0000-0000-0000-000000e00100', 'user_kind', 'client', 'user_role', null
)::text, true);
select is(
  public.is_conversation_participant(:conv_id::uuid), false,
  'T13.4: deactivated participant (is_active=false) is denied the channel'
);

-- ── (5) admin who is NOT a participant is denied (no admin override here) ─────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'f8000000-0000-0000-0000-000000e00600', 'role', 'authenticated',
  'org_id', 'f8000000-0000-0000-0000-000000e00100', 'user_kind', 'staff', 'user_role', 'admin'
)::text, true);
select is(
  public.is_conversation_participant(:conv_id::uuid), false,
  'T13.5: non-participant admin is denied the conv:{id} channel (no is_admin override)'
);

-- ── (6) deny-by-default: unknown conversation id => false ────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'f8000000-0000-0000-0000-000000e00200', 'role', 'authenticated',
  'org_id', 'f8000000-0000-0000-0000-000000e00100', 'user_kind', 'client', 'user_role', null
)::text, true);
select is(
  public.is_conversation_participant(:unknown_id::uuid), false,
  'T13.6: unknown conversation id is denied (deny-by-default)'
);

-- ── (7) anon cannot execute the helper at all (grant revoked) ────────────────
set local role postgres;
set local role anon;
select throws_ok(
  $$ select public.is_conversation_participant('f8000000-0000-0000-0000-000000e00700'::uuid) $$,
  '42501', null,
  'T13.7: anon cannot execute is_conversation_participant (execute revoked)'
);

select * from finish();
rollback;
