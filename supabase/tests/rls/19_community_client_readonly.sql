-- =============================================================================
-- 19_community_client_readonly.sql
-- DOC-31 §8.2 — Tests 25 and 26
--
-- Asserts the community block policies (0012_community.sql, DOC-30 §12).
-- Community is read/react/comment for kind='client'; publication/moderation is
-- staff with module 'community'.
--
-- Test 25 (community_posts — client is read-only):
--   community_posts_select:
--     org_id = auth_org_id()
--     AND ( (is_client() AND is_published) OR has_module('community', false) )
--   → A client reads ONLY published posts of their org; never is_published=false.
--   community_posts_insert: has_module('community', true) → a client CANNOT INSERT.
--
-- Test 26 (publication by module):
--   • Staff WITHOUT the community module cannot INSERT a post (42501).
--   • Staff WITH community can_edit CAN INSERT a post (lives_ok).
--
-- Fixtures (prefix f19…, own transaction):
--   Org O19 (…c00100)
--   Client       (…c00200) — kind=client
--   Staff no-comm (…c00300) — paralegal, NO community module
--   Staff comm    (…c00400) — has community module (view+edit)
--   published post (…c00500)  — is_published=true
--   draft post     (…c00600)  — is_published=false (client must not see it)
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id        '''f1900000-0000-0000-0000-00000cc00100'''
\set client_id     '''f1900000-0000-0000-0000-00000cc00200'''
\set staff_nocomm  '''f1900000-0000-0000-0000-00000cc00300'''
\set staff_comm    '''f1900000-0000-0000-0000-00000cc00400'''
\set post_pub      '''f1900000-0000-0000-0000-00000cc00500'''
\set post_draft    '''f1900000-0000-0000-0000-00000cc00600'''

-- ── Fixtures (postgres = bypass RLS) ──────────────────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:client_id::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t19@test.invalid',    now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_nocomm::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'nocomm_t19@test.invalid',    now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_comm::uuid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'comm_t19@test.invalid',      now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T19');

insert into public.users (id, org_id, kind, is_active) values
  (:client_id::uuid,    :org_id::uuid, 'client', true),
  (:staff_nocomm::uuid, :org_id::uuid, 'staff',  true),
  (:staff_comm::uuid,   :org_id::uuid, 'staff',  true);

insert into public.staff_profiles (user_id, role, display_name) values
  (:staff_nocomm::uuid, 'paralegal', 'NoComm_T19'),
  (:staff_comm::uuid,   'sales',     'Comm_T19');

-- community module only for staff_comm
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit)
values (:staff_comm::uuid, 'community', true, true);

-- one published post, one draft (is_published=false)
insert into public.community_posts (id, org_id, kind, body, is_published) values
  (:post_pub::uuid,   :org_id::uuid, 'text', 'Published post body', true),
  (:post_draft::uuid, :org_id::uuid, 'text', 'Draft post body',     false);

-- ── Test 25: client is read-only and sees only published posts ────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1900000-0000-0000-0000-00000cc00200',
  'role',      'authenticated',
  'org_id',    'f1900000-0000-0000-0000-00000cc00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

-- T25a: client sees exactly 1 post (the published one)
select results_eq(
  $$ select count(*)::bigint from public.community_posts $$,
  $$ values (1::bigint) $$,
  'T25a: client sees exactly 1 community_post (only is_published=true)'
);

-- T25b: client cannot see the draft (is_published=false)
select is_empty(
  $$ select id from public.community_posts
     where id = 'f1900000-0000-0000-0000-00000cc00600'::uuid $$,
  'T25b: client cannot see an unpublished community_post'
);

-- T25c: client cannot INSERT a post (publication is staff-only)
select throws_ok(
  $$ insert into public.community_posts (org_id, kind, body, is_published)
     values (
       'f1900000-0000-0000-0000-00000cc00100'::uuid,
       'text', 'client tried to post', true
     ) $$,
  '42501',
  null,
  'T25c: client cannot INSERT a community_post (community module required)'
);

-- ── Test 26: publication gated by the community module ────────────────────────
-- Staff WITHOUT community module: cannot INSERT
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1900000-0000-0000-0000-00000cc00300',
  'role',      'authenticated',
  'org_id',    'f1900000-0000-0000-0000-00000cc00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T26a: staff without community module sees 0 posts (no client branch, no module)
select is_empty(
  $$ select id from public.community_posts $$,
  'T26a: staff without community module sees 0 community_posts'
);

-- T26b: staff without community module cannot INSERT a post (42501)
select throws_ok(
  $$ insert into public.community_posts (org_id, kind, body, is_published)
     values (
       'f1900000-0000-0000-0000-00000cc00100'::uuid,
       'text', 'no-module post', true
     ) $$,
  '42501',
  null,
  'T26b: staff without community module cannot INSERT a community_post'
);

-- Staff WITH community module: CAN INSERT (and sees all, incl. draft)
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1900000-0000-0000-0000-00000cc00400',
  'role',      'authenticated',
  'org_id',    'f1900000-0000-0000-0000-00000cc00100',
  'user_kind', 'staff',
  'user_role', 'sales'
)::text, true);

-- T26c: staff with community module CAN INSERT a post
select lives_ok(
  $$ insert into public.community_posts (org_id, kind, body, is_published)
     values (
       'f1900000-0000-0000-0000-00000cc00100'::uuid,
       'text', 'staff published post', true
     ) $$,
  'T26c: staff with community module CAN INSERT a community_post'
);

select * from finish();
rollback;
