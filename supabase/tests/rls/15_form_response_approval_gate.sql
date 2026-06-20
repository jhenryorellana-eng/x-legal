-- =============================================================================
-- 15_form_response_approval_gate.sql
-- DOC-31 §8.2 — Test 16
--
-- Asserts the case_form_responses client UPDATE gate (0004_cases.sql):
--
--   case_form_responses_update_client:
--     USING      ( is_case_member(case_id) AND status = 'draft' )
--     WITH CHECK ( is_case_member(case_id) AND status in ('draft','submitted') )
--
-- The client may edit their own draft and submit it (draft → submitted), but
-- can NEVER set status='approved': that value is outside the client WITH CHECK
-- set, and the staff branch (has_module('cases', true)) does not apply to a
-- client. Self-approval is therefore blocked by RLS (the trigger N3 is a second
-- line of defence, not exercised here).
--
-- Also verified:
--   • A row already in status='submitted' is no longer editable by the client
--     (the client USING requires status='draft') — the client cannot pull an
--     already-submitted answer back nor mutate it.
--   • Positive path: client can move their own draft to 'submitted'.
--   • The client INSERT path is scoped to status='draft' on a form whose
--     filled_by is client/both (insert_client policy).
--
-- Fixtures (prefix f15…, own transaction):
--   Org O15 (…f00100)
--   Client (…f00200) — member (owner) of Case (…f00400)
--   service → phase → plan skeleton
--   form_definition filled_by='client' (…f00500)
--   draft response on the case (…f00600)
--   already-submitted response on the case (…f00700)
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id        '''f1500000-0000-0000-0000-00000ff00100'''
\set client_id     '''f1500000-0000-0000-0000-00000ff00200'''
\set case_id       '''f1500000-0000-0000-0000-00000ff00400'''
\set form_def_id   '''f1500000-0000-0000-0000-00000ff00500'''
\set resp_draft    '''f1500000-0000-0000-0000-00000ff00600'''
\set resp_submit   '''f1500000-0000-0000-0000-00000ff00700'''
\set service_id    '''f1500000-0000-0000-0000-00000ff00800'''
\set plan_id       '''f1500000-0000-0000-0000-00000ff00900'''
\set phase_id      '''f1500000-0000-0000-0000-00000ff00a00'''

-- ── Fixtures (postgres = bypass RLS) ──────────────────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:client_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t15@test.invalid', now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T15');

insert into public.users (id, org_id, kind, is_active) values
  (:client_id::uuid, :org_id::uuid, 'client', true);

insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t15', 'migratorio',
        '{"es":"Svc T15","en":"Svc T15"}'::jsonb, true);
insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t15',
        '{"es":"Fase","en":"Phase"}'::jsonb, 1);
insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:plan_id::uuid, :service_id::uuid, 'self', 10000, 'USD', true);

-- form_definition the client is allowed to fill
insert into public.form_definitions (id, service_phase_id, slug, kind, label_i18n, filled_by, is_active)
values (:form_def_id::uuid, :phase_id::uuid, 'form-t15', 'pdf_automation',
        '{"es":"Formulario","en":"Form"}'::jsonb, 'client', true);

insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T15-CASE-1', :service_id::uuid, :plan_id::uuid,
   :client_id::uuid, 'active');

insert into public.case_members (case_id, user_id, access_role)
values (:case_id::uuid, :client_id::uuid, 'owner');

-- a draft response and an already-submitted response
insert into public.case_form_responses (id, case_id, form_definition_id, answers, status)
values
  (:resp_draft::uuid,  :case_id::uuid, :form_def_id::uuid, '{"q1":"a"}'::jsonb, 'draft'),
  (:resp_submit::uuid, :case_id::uuid, :form_def_id::uuid, '{"q1":"b"}'::jsonb, 'submitted');

-- ── Act as the client ─────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f1500000-0000-0000-0000-00000ff00200',
  'role',      'authenticated',
  'org_id',    'f1500000-0000-0000-0000-00000ff00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

-- T16a: client cannot set status='approved' on their own draft (WITH CHECK fails → 42501)
select throws_ok(
  $$ update public.case_form_responses set status = 'approved'
     where id = 'f1500000-0000-0000-0000-00000ff00600'::uuid $$,
  '42501',
  null,
  'T16a: client cannot self-approve a draft (status=approved violates WITH CHECK)'
);

-- T16b: client cannot edit the answers of an already-submitted response
--       (client USING requires status='draft' → 0 rows match → UPDATE affects 0 rows)
select is_empty(
  $$ update public.case_form_responses set answers = '{"q1":"hacked"}'::jsonb
     where id = 'f1500000-0000-0000-0000-00000ff00700'::uuid returning id $$,
  'T16b: client UPDATE on a submitted response affects 0 rows (only draft is editable)'
);

-- T16c (positive): client can edit the answers of their own draft
select lives_ok(
  $$ update public.case_form_responses set answers = '{"q1":"edited"}'::jsonb
     where id = 'f1500000-0000-0000-0000-00000ff00600'::uuid $$,
  'T16c: client CAN edit the answers of their own draft'
);

-- T16d (positive): client can submit their own draft (draft → submitted)
select lives_ok(
  $$ update public.case_form_responses set status = 'submitted'
     where id = 'f1500000-0000-0000-0000-00000ff00600'::uuid $$,
  'T16d: client CAN submit their own draft (draft → submitted)'
);

-- T16e: after submitting, the client can no longer set it back to approved
--       (USING now sees status='submitted' → 0 rows → no escalation)
select is_empty(
  $$ update public.case_form_responses set status = 'approved'
     where id = 'f1500000-0000-0000-0000-00000ff00600'::uuid returning id $$,
  'T16e: once submitted, client UPDATE to approved affects 0 rows (no self-approval)'
);

-- T16f: client cannot INSERT a response already in status='submitted'
--       (insert_client requires status='draft')
select throws_ok(
  $$ insert into public.case_form_responses (case_id, form_definition_id, answers, status)
     values (
       'f1500000-0000-0000-0000-00000ff00400'::uuid,
       'f1500000-0000-0000-0000-00000ff00500'::uuid,
       '{"q1":"x"}'::jsonb, 'submitted'
     ) $$,
  '42501',
  null,
  'T16f: client cannot INSERT a response with status=submitted (only draft on insert)'
);

select * from finish();
rollback;
