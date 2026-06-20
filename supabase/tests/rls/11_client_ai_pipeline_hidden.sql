-- =============================================================================
-- 11_client_ai_pipeline_hidden.sql
-- DOC-31 §8.2 — Test 4
--
-- Verbatim from DOC-31 §8.2, row 4:
--   "Cliente no SELECT `ai_generation_runs` ni `document_extractions`
--    → costes/pipeline ocultos"
--
-- Security model (0004_cases.sql policies):
--
--   ai_generation_runs_select:
--     FOR SELECT TO authenticated
--     USING ( (select public.has_module('cases', false)) )
--     → Only staff with the 'cases' module. No branch for clients.
--     A client (user_kind='client') calling has_module() always returns
--     false because has_module checks employee_module_permissions, which
--     has no rows for clients. Result: 0 rows visible to any client.
--
--   ai_generation_runs_insert:
--     WITH CHECK ( (select public.has_module('cases', true)) AND ... )
--     → Same gate: client cannot pass has_module → SQLSTATE 42501.
--
--   document_extractions_select:
--     FOR SELECT TO authenticated
--     USING (
--       exists (
--         select 1 from public.case_documents d
--          where d.id = case_document_id
--            and (select public.has_module('cases', false))
--       )
--     )
--     → The sub-select requires has_module('cases', false). Client never
--       satisfies this, so the EXISTS is always false → 0 rows.
--     No INSERT policy for authenticated role (service_role only).
--
-- Fixtures:
--   Org O11 (…b00100)
--   Client   (…b00200) — case member (owner) of Case (…b00400)
--   Staff    (…b00300) — paralegal, employee_module_permissions: cases can_view=true can_edit=true
--   Service/plan/phase skeleton (…b00500 / …b00600 / …b00700)
--   form_definition  (…b00800) — required by ai_generation_runs.form_definition_id FK
--   case_document    (…b00900) — uploaded by client, required by document_extractions FK
--   ai_generation_run (…b00a00) — inserted as postgres (bypasses RLS)
--   document_extraction (…b00b00) — inserted as postgres
--
-- Assertions (plan = 5):
--   T4a: client sees 0 ai_generation_runs (has_module gate)
--   T4b: client sees 0 document_extractions (has_module gate in sub-select)
--   T4c: client cannot INSERT ai_generation_runs (42501)
--   T4d: staff WITH cases module CAN see the ai_generation_run (contrast positive)
--   T4e: staff WITH cases module CAN see the document_extraction (contrast positive)
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

-- ── UUIDs used in this test ──────────────────────────────────────────────────
\set org_id         '''f11b0000-0000-0000-0000-000000b00100'''
\set client_id      '''f11b0000-0000-0000-0000-000000b00200'''
\set staff_id       '''f11b0000-0000-0000-0000-000000b00300'''
\set case_id        '''f11b0000-0000-0000-0000-000000b00400'''
\set service_id     '''f11b0000-0000-0000-0000-000000b00500'''
\set svc_plan_id    '''f11b0000-0000-0000-0000-000000b00600'''
\set phase_id       '''f11b0000-0000-0000-0000-000000b00700'''
\set form_def_id    '''f11b0000-0000-0000-0000-000000b00800'''
\set case_doc_id    '''f11b0000-0000-0000-0000-000000b00900'''
\set run_id         '''f11b0000-0000-0000-0000-000000b00a00'''
\set extraction_id  '''f11b0000-0000-0000-0000-000000b00b00'''

-- ── Fixtures (running as postgres = bypass RLS) ───────────────────────────────

-- auth.users — minimum columns + token columns normalized to '' (GoTrue requirement)
insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:client_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t11@test.invalid', now(), now(), '', '', '', '', '', '', '', ''),
  (:staff_id::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff_t11@test.invalid',  now(), now(), '', '', '', '', '', '', '', '');

-- org
insert into public.orgs (id, name)
values (:org_id::uuid, 'TestOrg_T11');

-- public.users
insert into public.users (id, org_id, kind, is_active)
values
  (:client_id::uuid, :org_id::uuid, 'client', true),
  (:staff_id::uuid,  :org_id::uuid, 'staff',  true);

-- staff_profiles — required by has_module() (employee_module_permissions FK)
insert into public.staff_profiles (user_id, role, display_name)
values (:staff_id::uuid, 'paralegal', 'CasesParalegal_T11');

-- employee_module_permissions: staff has cases module with can_view+can_edit
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit)
values (:staff_id::uuid, 'cases', true, true);

-- service catalog skeleton
insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t11', 'migratorio',
        '{"es":"Servicio Test 11","en":"Test Service 11"}'::jsonb, true);

insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t11',
        '{"es":"Fase 1","en":"Phase 1"}'::jsonb, 1);

insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:svc_plan_id::uuid, :service_id::uuid, 'self', 10000, 'USD', true);

-- form_definition — required by ai_generation_runs.form_definition_id FK
insert into public.form_definitions (id, service_phase_id, slug, kind, label_i18n, filled_by, is_active)
values (:form_def_id::uuid, :phase_id::uuid, 'letter-t11', 'ai_letter',
        '{"es":"Carta","en":"Letter"}'::jsonb, 'staff', true);

-- case
insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T11-CASE-A', :service_id::uuid, :svc_plan_id::uuid,
   :client_id::uuid, 'active');

-- case_members: client is owner of their case
insert into public.case_members (case_id, user_id, access_role)
values (:case_id::uuid, :client_id::uuid, 'owner');

-- case_document: uploaded by client (required by document_extractions FK)
insert into public.case_documents
  (id, case_id, uploaded_by, storage_path, original_filename, mime_type, size_bytes)
values
  (:case_doc_id::uuid, :case_id::uuid, :client_id::uuid,
   'case/f11b0000-0000-0000-0000-000000b00400/doc_t11.pdf',
   'doc_t11.pdf', 'application/pdf', 2048);

-- ai_generation_run — pipeline row inserted by postgres (service_role equivalent)
-- Required NOT NULL: id, case_id, form_definition_id, config_snapshot, status, version, is_test
insert into public.ai_generation_runs
  (id, case_id, form_definition_id, config_snapshot, status, version, is_test)
values
  (:run_id::uuid, :case_id::uuid, :form_def_id::uuid,
   '{"model":"claude-sonnet-4-6"}'::jsonb,
   'completed', 1, false);

-- document_extraction — pipeline row inserted by postgres (service_role equivalent)
-- Required NOT NULL: id, case_document_id, model, status
insert into public.document_extractions
  (id, case_document_id, model, status)
values
  (:extraction_id::uuid, :case_doc_id::uuid, 'gemini-1.5-pro', 'completed');

-- ── Helper: set JWT claims for CLIENT ────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f11b0000-0000-0000-0000-000000b00200',
  'role',      'authenticated',
  'org_id',    'f11b0000-0000-0000-0000-000000b00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

-- T4a: client (case member) sees 0 ai_generation_runs
--      Policy: has_module('cases', false) — client never satisfies this
select is_empty(
  $$ select id from public.ai_generation_runs $$,
  'T4a: client member sees 0 ai_generation_runs (costes/pipeline ocultos)'
);

-- T4b: client (case member) sees 0 document_extractions
--      Policy: sub-select requires has_module('cases', false) — client fails
select is_empty(
  $$ select id from public.document_extractions $$,
  'T4b: client member sees 0 document_extractions (costes/pipeline ocultos)'
);

-- T4c: client cannot INSERT into ai_generation_runs (42501)
--      Policy ai_generation_runs_insert requires has_module('cases', true)
select throws_ok(
  $$ insert into public.ai_generation_runs
       (case_id, form_definition_id, config_snapshot, status, version, is_test, requested_by)
     values (
       'f11b0000-0000-0000-0000-000000b00400'::uuid,
       'f11b0000-0000-0000-0000-000000b00800'::uuid,
       '{"model":"claude-sonnet-4-6"}'::jsonb,
       'queued', 2, false,
       'f11b0000-0000-0000-0000-000000b00200'::uuid
     ) $$,
  '42501',
  null,
  'T4c: client cannot INSERT ai_generation_runs (42501 — no cases module)'
);

-- ── Switch to STAFF (has cases module) — contrast positive ───────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f11b0000-0000-0000-0000-000000b00300',
  'role',      'authenticated',
  'org_id',    'f11b0000-0000-0000-0000-000000b00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T4d: staff WITH cases module CAN see the ai_generation_run
select results_eq(
  $$ select count(*)::bigint from public.ai_generation_runs $$,
  $$ values (1::bigint) $$,
  'T4d: staff with cases module sees 1 ai_generation_run (contrast positive)'
);

-- T4e: staff WITH cases module CAN see the document_extraction
select results_eq(
  $$ select count(*)::bigint from public.document_extractions $$,
  $$ values (1::bigint) $$,
  'T4e: staff with cases module sees 1 document_extraction (contrast positive)'
);

select * from finish();
rollback;
