-- =============================================================================
-- 14_client_child_table_isolation.sql
-- DOC-31 §8.2 — Tests 2, 3 and 5
--
-- Test 2: Client A cannot SELECT case_documents of a case they are NOT a member
--         of. Child-table isolation inherits the case_members gate via
--         is_case_member(case_id) (extends Test 1 to a cross-case document).
--
-- Test 3: Client sees ONLY case_timeline rows with visible_to_client=true for
--         their OWN case. The SELECT contract (0004_cases.sql) splits into:
--           case_timeline_select_client: is_case_member(case_id) AND visible_to_client
--           case_timeline_select_staff:  has_module('cases', false)
--         A client never satisfies the staff branch, so internal events
--         (visible_to_client=false) are invisible to them.
--
-- Test 5: A client (even a case member) sees 0 rows in the expediente assembler
--         and legal loop tables — Block 8 (expedientes, expediente_items) and
--         Block 9 (legal_validations) have NO client branch in any policy.
--         The client only ever receives published outputs as case_documents
--         (DOC-30 §8). A case member is used so the assertion proves the gate
--         is the module matrix, not mere case-membership.
--
-- Fixtures (prefix f1a…, own transaction, no seeds dependency):
--   Org O14 (…a00100)
--   Client A (…a00200) — member (owner) of Case A (…a00400)
--   Client B (…a00300) — member (owner) of Case B (…a00500), NOT a member of Case A
--   Staff    (…a00600) — paralegal with expedientes module (positive control)
--   service → phase → plan skeleton
--   case_document on Case B (…a00700)  — Client A must not see it (Test 2)
--   2 case_timeline rows on Case A: one visible_to_client=true (…a00800),
--                                   one visible_to_client=false (…a00900)
--   expediente on Case A (…a00a00) + expediente_item (…a00b00)
--   legal_validation on Case A (…a00c00)
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id        '''f1a00000-0000-0000-0000-00000aa00100'''
\set client_a      '''f1a00000-0000-0000-0000-00000aa00200'''
\set client_b      '''f1a00000-0000-0000-0000-00000aa00300'''
\set case_a_id     '''f1a00000-0000-0000-0000-00000aa00400'''
\set case_b_id     '''f1a00000-0000-0000-0000-00000aa00500'''
\set staff_id      '''f1a00000-0000-0000-0000-00000aa00600'''
\set doc_b_id      '''f1a00000-0000-0000-0000-00000aa00700'''
\set tl_visible    '''f1a00000-0000-0000-0000-00000aa00800'''
\set tl_internal   '''f1a00000-0000-0000-0000-00000aa00900'''
\set expediente_id '''f1a00000-0000-0000-0000-00000aa00a00'''
\set exp_item_id   '''f1a00000-0000-0000-0000-00000aa00b00'''
\set validation_id '''f1a00000-0000-0000-0000-00000aa00c00'''
\set service_id    '''f1a00000-0000-0000-0000-00000aa00d00'''
\set plan_id       '''f1a00000-0000-0000-0000-00000aa00e00'''
\set phase_id      '''f1a00000-0000-0000-0000-00000aa00f00'''

-- ── Fixtures (running as postgres = bypass RLS) ───────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:client_a::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_a_t14@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:client_b::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_b_t14@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_t14@test.invalid',    now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T14');

insert into public.users (id, org_id, kind, is_active) values
  (:client_a::uuid, :org_id::uuid, 'client', true),
  (:client_b::uuid, :org_id::uuid, 'client', true),
  (:staff_id::uuid, :org_id::uuid, 'staff',  true);

insert into public.staff_profiles (user_id, role, display_name)
values (:staff_id::uuid, 'paralegal', 'Paralegal_T14');

-- staff has expedientes + validations modules (positive control for Test 5)
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit) values
  (:staff_id::uuid, 'expedientes', true, true),
  (:staff_id::uuid, 'validations', true, false);

-- service catalog skeleton
insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t14', 'migratorio',
        '{"es":"Svc T14","en":"Svc T14"}'::jsonb, true);
insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t14',
        '{"es":"Fase","en":"Phase"}'::jsonb, 1);
insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, 'self', 10000, 'USD', true);

-- two cases, no cross-membership
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_a_id::uuid, :org_id::uuid, 'T14-CASE-A', :service_id::uuid, :plan_id::uuid,
   :client_a::uuid, 'active'),
  (:case_b_id::uuid, :org_id::uuid, 'T14-CASE-B', :service_id::uuid, :plan_id::uuid,
   :client_b::uuid, 'active');

insert into public.case_members (case_id, user_id, access_role) values
  (:case_a_id::uuid, :client_a::uuid, 'owner'),
  (:case_b_id::uuid, :client_b::uuid, 'owner');

-- case_document on Case B — Client A must not see it (Test 2)
insert into public.case_documents
  (id, case_id, uploaded_by, storage_path, original_filename, mime_type, size_bytes)
values
  (:doc_b_id::uuid, :case_b_id::uuid, :client_b::uuid,
   'case/f1a00000-0000-0000-0000-00000aa00500/doc_b.pdf', 'doc_b.pdf', 'application/pdf', 1024);

-- two timeline rows on Case A: one client-visible, one internal (Test 3)
insert into public.case_timeline
  (id, case_id, event_type, icon, color, title_i18n, actor_kind, visible_to_client)
values
  (:tl_visible::uuid,  :case_a_id::uuid, 'document.uploaded', 'info', 'accent',
   '{"es":"Visible","en":"Visible"}'::jsonb, 'system', true),
  (:tl_internal::uuid, :case_a_id::uuid, 'internal.note',     'info', 'accent',
   '{"es":"Interno","en":"Internal"}'::jsonb, 'system', false);

-- expediente assembler rows on Case A — never visible to a client (Test 5)
insert into public.expedientes (id, case_id, attempt_no, status, built_by)
values (:expediente_id::uuid, :case_a_id::uuid, 1, 'draft', :staff_id::uuid);

insert into public.expediente_items (id, expediente_id, position, item_type, title)
values (:exp_item_id::uuid, :expediente_id::uuid, 1, 'client_document', 'Item 1');

-- legal_validation on Case A — never visible to a client (Test 5)
insert into public.legal_validations
  (id, case_id, expediente_id, attempt_no, status)
values
  (:validation_id::uuid, :case_a_id::uuid, :expediente_id::uuid, 1, 'pending');

-- ── Act as Client A (member of Case A only) ──────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1a00000-0000-0000-0000-00000aa00200',
  'role',      'authenticated',
  'org_id',    'f1a00000-0000-0000-0000-00000aa00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

-- T2: client A cannot see the case_document of Case B (child-table isolation)
select is_empty(
  $$ select id from public.case_documents
     where id = 'f1a00000-0000-0000-0000-00000aa00700'::uuid $$,
  'T2: client A gets 0 rows for a case_document of a case they are not a member of'
);
-- And in aggregate: client A sees 0 case_documents total (their own case has none)
select is_empty(
  $$ select id from public.case_documents $$,
  'T2: client A sees 0 case_documents in aggregate (no doc on their own case)'
);

-- T3: client A sees ONLY the visible_to_client=true timeline row of their case
select results_eq(
  $$ select count(*)::bigint from public.case_timeline $$,
  $$ values (1::bigint) $$,
  'T3: client A sees exactly 1 case_timeline row (visible_to_client=true only)'
);
select is_empty(
  $$ select id from public.case_timeline
     where id = 'f1a00000-0000-0000-0000-00000aa00900'::uuid $$,
  'T3: client A cannot see the visible_to_client=false (internal) timeline row'
);

-- T5: client A (case member) sees 0 expedientes / expediente_items / legal_validations
select is_empty(
  $$ select id from public.expedientes $$,
  'T5: client (case member) sees 0 expedientes (Block 8 has no client branch)'
);
select is_empty(
  $$ select id from public.expediente_items $$,
  'T5: client (case member) sees 0 expediente_items (gated via expedientes module)'
);
select is_empty(
  $$ select id from public.legal_validations $$,
  'T5: client (case member) sees 0 legal_validations (Block 9 has no client branch)'
);

select * from finish();
rollback;
