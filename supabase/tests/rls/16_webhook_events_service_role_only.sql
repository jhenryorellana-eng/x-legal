-- =============================================================================
-- 16_webhook_events_service_role_only.sql
-- DOC-31 §8.2 — Test 19
--
-- Asserts webhook_events is P-SERVICE-ROLE-ONLY for writes (0009_integrations.sql):
--   • SELECT: org_id = auth_org_id() AND has_module('audit', false)  → only admin
--   • INSERT / UPDATE / DELETE: NO policy for authenticated → 42501.
--
-- An authenticated user — staff (even admin) OR client — can NEVER fabricate a
-- "processed webhook". Only the service_role (BYPASSRLS) inserts events from the
-- webhook endpoints. This protects the idempotency ledger from forgery: a client
-- cannot inject a fake "payment.succeeded" Stripe event row.
--
-- Assertions:
--   T19a: admin staff CANNOT INSERT webhook_events (42501) — strongest case:
--         even the role that can READ the table cannot write it.
--   T19b: paralegal CANNOT INSERT webhook_events (42501).
--   T19c: client CANNOT INSERT webhook_events (42501).
--   T19d: admin CANNOT UPDATE a webhook_event (no UPDATE policy → 0 rows).
--   T19e: admin staff with module 'audit' CAN SELECT the event (positive read).
--   T19f: client sees 0 webhook_events (no audit module, no client branch).
--
-- Fixtures (prefix f16…, own transaction):
--   Org O16 (…f00100)
--   Admin staff (…f00200) — role=admin, has audit module via bypass (admin)
--   Paralegal   (…f00300) — no audit module
--   Client      (…f00400)
--   webhook_event (…f00500) — inserted by postgres (service_role equivalent)
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id      '''f1600000-0000-0000-0000-00000ff00100'''
\set admin_id    '''f1600000-0000-0000-0000-00000ff00200'''
\set paralegal_id '''f1600000-0000-0000-0000-00000ff00300'''
\set client_id   '''f1600000-0000-0000-0000-00000ff00400'''
\set event_id    '''f1600000-0000-0000-0000-00000ff00500'''

-- ── Fixtures (postgres = bypass RLS) ──────────────────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:admin_id::uuid,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin_t16@test.invalid',     now(), now(), '', '', '', '', '', '', '', ''),
  (:paralegal_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'paralegal_t16@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:client_id::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t16@test.invalid',    now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T16');

insert into public.users (id, org_id, kind, is_active) values
  (:admin_id::uuid,     :org_id::uuid, 'staff',  true),
  (:paralegal_id::uuid, :org_id::uuid, 'staff',  true),
  (:client_id::uuid,    :org_id::uuid, 'client', true);

insert into public.staff_profiles (user_id, role, display_name) values
  (:admin_id::uuid,     'admin',     'Admin_T16'),
  (:paralegal_id::uuid, 'paralegal', 'Paralegal_T16');

-- pre-existing webhook event (inserted by postgres = service_role equivalent)
insert into public.webhook_events
  (id, org_id, source, event_type, idempotency_key, signature_valid, raw_body)
values
  (:event_id::uuid, :org_id::uuid, 'stripe', 'payment_intent.succeeded',
   'evt_t16_0001', true, '{"id":"evt_t16_0001"}'::jsonb);

-- ── T19a: admin CANNOT INSERT a webhook_event (42501 — service_role only) ─────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1600000-0000-0000-0000-00000ff00200',
  'role',      'authenticated',
  'org_id',    'f1600000-0000-0000-0000-00000ff00100',
  'user_kind', 'staff',
  'user_role', 'admin'
)::text, true);

select throws_ok(
  $$ insert into public.webhook_events
       (org_id, source, idempotency_key, signature_valid, raw_body)
     values (
       'f1600000-0000-0000-0000-00000ff00100'::uuid,
       'stripe', 'evt_t16_forged_admin', true, '{"forged":true}'::jsonb
     ) $$,
  '42501',
  null,
  'T19a: admin staff cannot INSERT webhook_events (P-SERVICE-ROLE-ONLY)'
);

-- T19d: admin cannot UPDATE a webhook_event (no UPDATE policy → 0 rows affected)
select is_empty(
  $$ update public.webhook_events set error = 'tampered'
     where id = 'f1600000-0000-0000-0000-00000ff00500'::uuid returning id $$,
  'T19d: admin UPDATE on webhook_events affects 0 rows (service_role-only write)'
);

-- T19e (positive): admin with audit access CAN read the event
select results_eq(
  $$ select count(*)::bigint from public.webhook_events $$,
  $$ values (1::bigint) $$,
  'T19e: admin (audit access via bypass) can SELECT the webhook_event'
);

-- ── T19b: paralegal CANNOT INSERT a webhook_event (42501) ─────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1600000-0000-0000-0000-00000ff00300',
  'role',      'authenticated',
  'org_id',    'f1600000-0000-0000-0000-00000ff00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

select throws_ok(
  $$ insert into public.webhook_events
       (org_id, source, idempotency_key, signature_valid, raw_body)
     values (
       'f1600000-0000-0000-0000-00000ff00100'::uuid,
       'stripe', 'evt_t16_forged_para', true, '{"forged":true}'::jsonb
     ) $$,
  '42501',
  null,
  'T19b: paralegal cannot INSERT webhook_events (P-SERVICE-ROLE-ONLY)'
);

-- ── T19c + T19f: client CANNOT INSERT and sees 0 webhook_events ───────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1600000-0000-0000-0000-00000ff00400',
  'role',      'authenticated',
  'org_id',    'f1600000-0000-0000-0000-00000ff00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

select throws_ok(
  $$ insert into public.webhook_events
       (org_id, source, idempotency_key, signature_valid, raw_body)
     values (
       'f1600000-0000-0000-0000-00000ff00100'::uuid,
       'stripe', 'evt_t16_forged_client', true, '{"forged":true}'::jsonb
     ) $$,
  '42501',
  null,
  'T19c: client cannot INSERT webhook_events (cannot fabricate a processed webhook)'
);

select is_empty(
  $$ select id from public.webhook_events $$,
  'T19f: client sees 0 webhook_events (no audit module, no client branch)'
);

select * from finish();
rollback;
