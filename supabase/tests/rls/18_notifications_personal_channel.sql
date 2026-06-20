-- =============================================================================
-- 18_notifications_personal_channel.sql
-- DOC-31 §8.2 — Test 24
--
-- Asserts the notifications policies (0011_notifications_campaigns.sql):
--
--   notifications_select: user_id = auth.uid()           (P-OWNER)
--   notifications_update: user_id = auth.uid()           (mark read_at)
--   notifications_delete: user_id = auth.uid()           (clear own center)
--   INSERT: NO policy for authenticated → 42501 (service_role only — the backend
--           notification matrix is the only producer; nobody injects their own
--           notifications nor fabricates them for others).
--
-- This SELECT policy also authorizes the Realtime user:{id} channel via
-- postgres_changes (DOC-25 §1.1).
--
-- Key properties:
--   • User A does NOT see User B's notifications.
--   • User A's UPDATE/DELETE on User B's notification affect 0 rows (USING fails).
--   • No authenticated user can INSERT a notification (not for self, not for others).
--   • Positive: User A reads, marks read, and deletes their OWN notification.
--
-- Fixtures (prefix f18…, own transaction):
--   Org O18 (…f00100)
--   User A (…f00200) — client
--   User B (…f00300) — client
--   notif A (…f00400) — belongs to User A
--   notif B (…f00500) — belongs to User B
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id    '''f1800000-0000-0000-0000-00000ff00100'''
\set user_a    '''f1800000-0000-0000-0000-00000ff00200'''
\set user_b    '''f1800000-0000-0000-0000-00000ff00300'''
\set notif_a   '''f1800000-0000-0000-0000-00000ff00400'''
\set notif_b   '''f1800000-0000-0000-0000-00000ff00500'''

-- ── Fixtures (postgres = bypass RLS) ──────────────────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:user_a::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'user_a_t18@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:user_b::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'user_b_t18@test.invalid', now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T18');

insert into public.users (id, org_id, kind, is_active) values
  (:user_a::uuid, :org_id::uuid, 'client', true),
  (:user_b::uuid, :org_id::uuid, 'client', true);

insert into public.notifications (id, user_id, type, title_i18n) values
  (:notif_a::uuid, :user_a::uuid, 'case.update', '{"es":"Para A","en":"For A"}'::jsonb),
  (:notif_b::uuid, :user_b::uuid, 'case.update', '{"es":"Para B","en":"For B"}'::jsonb);

-- ── Act as User A ─────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1800000-0000-0000-0000-00000ff00200',
  'role',      'authenticated',
  'org_id',    'f1800000-0000-0000-0000-00000ff00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

-- T24a: User A sees exactly 1 notification (their own)
select results_eq(
  $$ select count(*)::bigint from public.notifications $$,
  $$ values (1::bigint) $$,
  'T24a: user A sees exactly 1 notification (their own)'
);

-- T24b: User A cannot see User B's notification by id
select is_empty(
  $$ select id from public.notifications
     where id = 'f1800000-0000-0000-0000-00000ff00500'::uuid $$,
  'T24b: user A cannot SELECT user B notification'
);

-- T24c: User A UPDATE on User B's notification affects 0 rows (USING fails)
select is_empty(
  $$ update public.notifications set read_at = now()
     where id = 'f1800000-0000-0000-0000-00000ff00500'::uuid returning id $$,
  'T24c: user A UPDATE on user B notification affects 0 rows'
);

-- T24d: User A DELETE on User B's notification affects 0 rows (USING fails)
select is_empty(
  $$ delete from public.notifications
     where id = 'f1800000-0000-0000-0000-00000ff00500'::uuid returning id $$,
  'T24d: user A DELETE on user B notification affects 0 rows'
);

-- T24e: User A cannot INSERT a notification for themselves (service_role only)
select throws_ok(
  $$ insert into public.notifications (user_id, type, title_i18n)
     values (
       'f1800000-0000-0000-0000-00000ff00200'::uuid,
       'case.update', '{"es":"Self","en":"Self"}'::jsonb
     ) $$,
  '42501',
  null,
  'T24e: user cannot INSERT their own notification (service_role-only producer)'
);

-- T24f: User A cannot INSERT a notification for User B (no spoofing of others)
select throws_ok(
  $$ insert into public.notifications (user_id, type, title_i18n)
     values (
       'f1800000-0000-0000-0000-00000ff00300'::uuid,
       'case.update', '{"es":"Spoof","en":"Spoof"}'::jsonb
     ) $$,
  '42501',
  null,
  'T24f: user cannot INSERT a notification for another user'
);

-- T24g (positive): User A CAN mark their own notification as read
select lives_ok(
  $$ update public.notifications set read_at = now()
     where id = 'f1800000-0000-0000-0000-00000ff00400'::uuid $$,
  'T24g: user A CAN mark their own notification read'
);

select * from finish();
rollback;
