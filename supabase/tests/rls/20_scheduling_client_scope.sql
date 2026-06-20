-- =============================================================================
-- 20_scheduling_client_scope.sql
-- DOC-31 §8.2 — Tests 27 and 28
--
-- Asserts the scheduling block (0007_scheduling.sql, DOC-31 §7).
-- The client NEVER reads raw staff availability (slots are computed server-side
-- with the service client; SOT-RLS-6). RLS here is staff-only.
--
-- Test 27 (raw agenda hidden from client):
--   availability_rules / availability_exceptions / staff_scheduling_settings
--   SELECT: staff_id = auth.uid() OR has_module('availability', false)
--   → a client satisfies neither branch → 0 rows.
--
-- Test 28 (appointments self-service, bounded):
--   appointments_insert_client:
--     client_user_id = auth.uid() AND case_id is not null
--     AND is_case_member(case_id) AND status = 'scheduled'
--   appointments_update_client:
--     USING ( client_user_id = auth.uid() AND status = 'scheduled' )
--   → client books only on their OWN case as themselves; cannot book "as" another
--     client; cannot UPDATE another client's appointment.
--
-- Fixtures (prefix f20…, own transaction):
--   Org O20 (…700100)
--   client_a (…700200) — member of Case A (…700600)
--   client_b (…700300) — member of Case B (…700700)
--   staff    (…700400) — paralegal (availability rows belong to them)
--   service → phase → plan skeleton
--   availability_rule (…700800), availability_exception (…700900),
--   staff_scheduling_settings for staff
--   appointment for client_b on Case B (…700a00) — client_a must not UPDATE it
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id      '''f2000000-0000-0000-0000-000007700100'''
\set client_a    '''f2000000-0000-0000-0000-000007700200'''
\set client_b    '''f2000000-0000-0000-0000-000007700300'''
\set staff_id    '''f2000000-0000-0000-0000-000007700400'''
\set service_id  '''f2000000-0000-0000-0000-000007700500'''
\set case_a_id   '''f2000000-0000-0000-0000-000007700600'''
\set case_b_id   '''f2000000-0000-0000-0000-000007700700'''
\set rule_id     '''f2000000-0000-0000-0000-000007700800'''
\set exc_id      '''f2000000-0000-0000-0000-000007700900'''
\set appt_b_id   '''f2000000-0000-0000-0000-000007700a00'''
\set plan_id     '''f2000000-0000-0000-0000-000007700b00'''
\set phase_id    '''f2000000-0000-0000-0000-000007700c00'''

-- ── Fixtures (postgres = bypass RLS) ──────────────────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:client_a::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_a_t20@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:client_b::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_b_t20@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_t20@test.invalid',    now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T20');

insert into public.users (id, org_id, kind, is_active) values
  (:client_a::uuid, :org_id::uuid, 'client', true),
  (:client_b::uuid, :org_id::uuid, 'client', true),
  (:staff_id::uuid, :org_id::uuid, 'staff',  true);

insert into public.staff_profiles (user_id, role, display_name)
values (:staff_id::uuid, 'paralegal', 'Paralegal_T20');

insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t20', 'migratorio',
        '{"es":"Svc T20","en":"Svc T20"}'::jsonb, true);
insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t20',
        '{"es":"Fase","en":"Phase"}'::jsonb, 1);
insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, 'self', 10000, 'USD', true);

insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_a_id::uuid, :org_id::uuid, 'T20-CASE-A', :service_id::uuid, :plan_id::uuid,
   :client_a::uuid, 'active'),
  (:case_b_id::uuid, :org_id::uuid, 'T20-CASE-B', :service_id::uuid, :plan_id::uuid,
   :client_b::uuid, 'active');

insert into public.case_members (case_id, user_id, access_role) values
  (:case_a_id::uuid, :client_a::uuid, 'owner'),
  (:case_b_id::uuid, :client_b::uuid, 'owner');

-- raw availability rows belong to staff (Test 27 — must stay invisible to clients)
insert into public.availability_rules (id, staff_id, weekday, start_local, end_local, timezone)
values (:rule_id::uuid, :staff_id::uuid, 1, '09:00', '17:00', 'America/New_York');

insert into public.availability_exceptions (id, staff_id, starts_at, ends_at, reason)
values (:exc_id::uuid, :staff_id::uuid, now() + interval '1 day', now() + interval '2 day', 'PTO');

insert into public.staff_scheduling_settings (staff_id) values (:staff_id::uuid);

-- existing appointment for client_b on Case B (Test 28 — client_a must not UPDATE)
insert into public.appointments
  (id, case_id, service_phase_id, staff_id, client_user_id, starts_at, ends_at, kind, status)
values
  (:appt_b_id::uuid, :case_b_id::uuid, :phase_id::uuid, :staff_id::uuid, :client_b::uuid,
   now() + interval '3 day', now() + interval '3 day' + interval '30 min', 'video', 'scheduled');

-- ── Test 27: client sees no raw availability ──────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f2000000-0000-0000-0000-000007700200',
  'role',      'authenticated',
  'org_id',    'f2000000-0000-0000-0000-000007700100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

-- T27a: client sees 0 availability_rules
select is_empty(
  $$ select id from public.availability_rules $$,
  'T27a: client sees 0 availability_rules (raw agenda hidden)'
);
-- T27b: client sees 0 availability_exceptions
select is_empty(
  $$ select id from public.availability_exceptions $$,
  'T27b: client sees 0 availability_exceptions (raw agenda hidden)'
);
-- T27c: client sees 0 staff_scheduling_settings
select is_empty(
  $$ select staff_id from public.staff_scheduling_settings $$,
  'T27c: client sees 0 staff_scheduling_settings (raw agenda hidden)'
);

-- ── Test 28: appointment self-service bounded to own case + own identity ──────
-- T28a (positive): client A books an appointment on their OWN case as themselves
select lives_ok(
  $$ insert into public.appointments
       (case_id, service_phase_id, staff_id, client_user_id, starts_at, ends_at, kind, status)
     values (
       'f2000000-0000-0000-0000-000007700600'::uuid,
       'f2000000-0000-0000-0000-000007700c00'::uuid,
       'f2000000-0000-0000-0000-000007700400'::uuid,
       'f2000000-0000-0000-0000-000007700200'::uuid,
       now() + interval '5 day', now() + interval '5 day' + interval '30 min',
       'video', 'scheduled'
     ) $$,
  'T28a: client A CAN book an appointment on their own case as themselves'
);

-- T28b: client A cannot book "as" client B (client_user_id spoof) → 42501
select throws_ok(
  $$ insert into public.appointments
       (case_id, service_phase_id, staff_id, client_user_id, starts_at, ends_at, kind, status)
     values (
       'f2000000-0000-0000-0000-000007700600'::uuid,
       'f2000000-0000-0000-0000-000007700c00'::uuid,
       'f2000000-0000-0000-0000-000007700400'::uuid,
       'f2000000-0000-0000-0000-000007700300'::uuid,
       now() + interval '6 day', now() + interval '6 day' + interval '30 min',
       'video', 'scheduled'
     ) $$,
  '42501',
  null,
  'T28b: client A cannot INSERT an appointment with client_user_id = another client'
);

-- T28c: client A cannot book on a case they are NOT a member of (Case B) → 42501
select throws_ok(
  $$ insert into public.appointments
       (case_id, service_phase_id, staff_id, client_user_id, starts_at, ends_at, kind, status)
     values (
       'f2000000-0000-0000-0000-000007700700'::uuid,
       'f2000000-0000-0000-0000-000007700c00'::uuid,
       'f2000000-0000-0000-0000-000007700400'::uuid,
       'f2000000-0000-0000-0000-000007700200'::uuid,
       now() + interval '7 day', now() + interval '7 day' + interval '30 min',
       'video', 'scheduled'
     ) $$,
  '42501',
  null,
  'T28c: client A cannot INSERT an appointment on a case they are not a member of'
);

-- T28d: client A cannot UPDATE client B's appointment (USING fails → 0 rows)
select is_empty(
  $$ update public.appointments set notes = 'hacked'
     where id = 'f2000000-0000-0000-0000-000007700a00'::uuid returning id $$,
  'T28d: client A UPDATE on another client appointment affects 0 rows'
);

select * from finish();
rollback;
