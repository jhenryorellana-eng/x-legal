-- =============================================================================
-- 22_realtime_channels_multitenant.sql
-- DOC-31 §8.2 — Test 30
--
-- Two concerns:
--
--  (A) Realtime private channels (0015_realtime.sql). realtime.messages carries
--      no rows outside live traffic, so — like 13_messaging_realtime_conv_channel —
--      we assert the authorization PREDICATES of the policies directly under each
--      JWT context. The predicates are the variable terms of the USING/WITH CHECK
--      expressions; the topic-prefix / split_part casts are static.
--        • board:{id}  → owner_staff_id = auth.uid() OR is_admin()
--            client (never an owner) is denied; the board owner is allowed.
--        • team:{org}  → SELECT: is_staff() OR is_client()  (client observes)
--                        INSERT: is_staff()                  (client cannot track)
--
--  (B) Multi-tenant isolation (ADR-9, P-ORG). A JWT whose org_id belongs to a
--      DIFFERENT org returns 0 rows on a tenant-root table (cases): the policy
--      term org_id = auth_org_id() fails for the foreign tenant even when the
--      user's row and helper checks would otherwise pass.
--
-- Fixtures (prefix f22…, own transaction):
--   Org X (…200100) — primary tenant
--   Org Y (…2000aa) — foreign tenant
--   client_x  (…200200) — client of Org X
--   staff_x   (…200300) — paralegal of Org X (board owner)
--   admin_y   (…200400) — admin of Org Y (foreign tenant probe)
--   service → phase → plan → case in Org X
--   kanban_board owned by staff_x (…200800)
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_x       '''f2200000-0000-0000-0000-000002200100'''
\set org_y       '''f2200000-0000-0000-0000-0000022000aa'''
\set client_x    '''f2200000-0000-0000-0000-000002200200'''
\set staff_x     '''f2200000-0000-0000-0000-000002200300'''
\set admin_y     '''f2200000-0000-0000-0000-000002200400'''
\set service_id  '''f2200000-0000-0000-0000-000002200500'''
\set plan_id     '''f2200000-0000-0000-0000-000002200600'''
\set phase_id    '''f2200000-0000-0000-0000-000002200700'''
\set board_id    '''f2200000-0000-0000-0000-000002200800'''
\set case_x_id   '''f2200000-0000-0000-0000-000002200900'''

-- ── Fixtures (postgres = bypass RLS) ──────────────────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:client_x::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_x_t22@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_x::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_x_t22@test.invalid',  now(), now(), '', '', '', '', '', '', '', ''),
  (:admin_y::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin_y_t22@test.invalid',  now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name) values
  (:org_x::uuid, 'TestOrg_T22_X'),
  (:org_y::uuid, 'TestOrg_T22_Y');

insert into public.users (id, org_id, kind, is_active) values
  (:client_x::uuid, :org_x::uuid, 'client', true),
  (:staff_x::uuid,  :org_x::uuid, 'staff',  true),
  (:admin_y::uuid,  :org_y::uuid, 'staff',  true);

insert into public.staff_profiles (user_id, role, display_name) values
  (:staff_x::uuid, 'paralegal', 'StaffX_T22'),
  (:admin_y::uuid, 'admin',     'AdminY_T22');

-- staff_x owns a kanban board (board channel owner check)
insert into public.kanban_boards (id, org_id, owner_staff_id, board_kind)
values (:board_id::uuid, :org_x::uuid, :staff_x::uuid, 'leads');

-- service skeleton + a case in Org X (multi-tenant probe target)
insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_x::uuid, 'svc-t22', 'migratorio',
        '{"es":"Svc T22","en":"Svc T22"}'::jsonb, true);
insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t22',
        '{"es":"Fase","en":"Phase"}'::jsonb, 1);
insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, 'self', 10000, 'USD', true);
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_x_id::uuid, :org_x::uuid, 'T22-CASE-X', :service_id::uuid, :plan_id::uuid,
   :client_x::uuid, 'active');

-- =============================================================================
-- (A) Realtime channel predicates
-- =============================================================================

-- ── board:{id} — owner_staff_id = auth.uid() OR is_admin() ───────────────────
-- client_x is NOT a board owner → denied
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'f2200000-0000-0000-0000-000002200200', 'role', 'authenticated',
  'org_id', 'f2200000-0000-0000-0000-000002200100', 'user_kind', 'client', 'user_role', null
)::text, true);
select is(
  exists (
    select 1 from public.kanban_boards b
     where b.id = 'f2200000-0000-0000-0000-000002200800'::uuid
       and (b.owner_staff_id = (select auth.uid()) or (select public.is_admin()))
  ),
  false,
  'T30a: client cannot join board:{id} (not the owner, not admin)'
);

-- board owner (staff_x) IS allowed
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'f2200000-0000-0000-0000-000002200300', 'role', 'authenticated',
  'org_id', 'f2200000-0000-0000-0000-000002200100', 'user_kind', 'staff', 'user_role', 'paralegal'
)::text, true);
select is(
  exists (
    select 1 from public.kanban_boards b
     where b.id = 'f2200000-0000-0000-0000-000002200800'::uuid
       and (b.owner_staff_id = (select auth.uid()) or (select public.is_admin()))
  ),
  true,
  'T30b: board owner staff CAN join board:{id}'
);

-- ── team:{org} — SELECT: is_staff()||is_client(); INSERT: is_staff() ─────────
-- client_x: SELECT predicate TRUE (observe presence), INSERT predicate FALSE
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'f2200000-0000-0000-0000-000002200200', 'role', 'authenticated',
  'org_id', 'f2200000-0000-0000-0000-000002200100', 'user_kind', 'client', 'user_role', null
)::text, true);
select is(
  ((select public.is_staff()) or (select public.is_client())),
  true,
  'T30c: client passes team:{org} SELECT predicate (observes presence)'
);
select is(
  (select public.is_staff()),
  false,
  'T30d: client FAILS team:{org} INSERT predicate (cannot track presence)'
);

-- staff_x: INSERT predicate TRUE (can track presence)
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'f2200000-0000-0000-0000-000002200300', 'role', 'authenticated',
  'org_id', 'f2200000-0000-0000-0000-000002200100', 'user_kind', 'staff', 'user_role', 'paralegal'
)::text, true);
select is(
  (select public.is_staff()),
  true,
  'T30e: staff passes team:{org} INSERT predicate (tracks presence)'
);

-- =============================================================================
-- (B) Multi-tenant isolation: admin of Org Y sees 0 cases of Org X
-- =============================================================================
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'f2200000-0000-0000-0000-000002200400', 'role', 'authenticated',
  'org_id', 'f2200000-0000-0000-0000-0000022000aa', 'user_kind', 'staff', 'user_role', 'admin'
)::text, true);

-- T30f: admin of Org Y sees 0 cases of Org X (org_id = auth_org_id() fails)
select is_empty(
  $$ select id from public.cases
     where id = 'f2200000-0000-0000-0000-000002200900'::uuid $$,
  'T30f: admin of a foreign org sees 0 cases of another org (multi-tenant P-ORG)'
);
-- T30g: in aggregate, admin of Org Y (which has no cases) sees 0 cases
select is_empty(
  $$ select id from public.cases $$,
  'T30g: admin of Org Y sees 0 cases (their tenant has none; X is isolated)'
);

select * from finish();
rollback;
