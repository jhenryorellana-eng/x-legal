-- =============================================================================
-- 24_document_coverage_service_role_only.sql
-- Cobertura de documentos combinados (0107_document_coverage.sql)
--
-- Asserts case_document_coverages is P-SERVICE-ROLE-ONLY (RLS ON, ZERO
-- policies): only the service_role (BYPASSRLS — the classify-document-coverage
-- job and the cases dismiss/restore service) touches the table. Clients read
-- coverage exclusively through DTOs gated by requireCaseAccess.
--
-- Why zero policies (same model as case_ai_field_cache, 0091): a coverage row
-- carries confidence + extracted payload of ANOTHER document type. A client
-- must never fabricate one ("my upload covers everything") because a detected
-- coverage COUNTS toward the forms gate; nor read raw payloads/confidence
-- directly (the client UI only shows the derived "Cubierto por tu X").
--
-- Assertions (plan = 6):
--   T24a: admin staff sees 0 coverages (no SELECT policy — even admin)
--   T24b: client (case member/owner) sees 0 coverages
--   T24c: admin CANNOT INSERT a coverage (42501)
--   T24d: client CANNOT INSERT a coverage for their own case (42501) —
--         the gate cannot be self-opened
--   T24e: admin CANNOT UPDATE (no policy → 0 rows touched)
--   T24f: client CANNOT DELETE (no policy → 0 rows touched)
--
-- Fixtures (prefix f24…, own transaction):
--   Org O24, admin staff, client (case owner), service/plan/phase skeleton,
--   required_document_type (covered type), case, case_document (source upload),
--   case_document_coverages row — inserted by postgres (service_role equivalent).
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id       '''f2400000-0000-0000-0000-000000c00100'''
\set admin_id     '''f2400000-0000-0000-0000-000000c00200'''
\set client_id    '''f2400000-0000-0000-0000-000000c00300'''
\set service_id   '''f2400000-0000-0000-0000-000000c00400'''
\set svc_plan_id  '''f2400000-0000-0000-0000-000000c00500'''
\set phase_id     '''f2400000-0000-0000-0000-000000c00600'''
\set rdt_id       '''f2400000-0000-0000-0000-000000c00700'''
\set case_id      '''f2400000-0000-0000-0000-000000c00800'''
\set case_doc_id  '''f2400000-0000-0000-0000-000000c00900'''
\set coverage_id  '''f2400000-0000-0000-0000-000000c00a00'''

-- ── Fixtures (running as postgres = bypass RLS) ──────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:admin_id::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin_t24@test.invalid',  now(), now(), '', '', '', '', '', '', '', ''),
  (:client_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'client_t24@test.invalid', now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name) values (:org_id::uuid, 'TestOrg_T24');

insert into public.users (id, org_id, kind, is_active) values
  (:admin_id::uuid,  :org_id::uuid, 'staff',  true),
  (:client_id::uuid, :org_id::uuid, 'client', true);

insert into public.staff_profiles (user_id, role, display_name)
values (:admin_id::uuid, 'admin', 'Admin_T24');

insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t24', 'migratorio',
        '{"es":"Servicio Test 24","en":"Test Service 24"}'::jsonb, true);

insert into public.service_phases (id, service_id, slug, label_i18n, position)
values (:phase_id::uuid, :service_id::uuid, 'fase-t24',
        '{"es":"Fase 1","en":"Phase 1"}'::jsonb, 1);

insert into public.service_plans (id, service_id, kind, price_cents, currency, is_active)
values (:svc_plan_id::uuid, :service_id::uuid, 'self', 10000, 'USD', true);

-- covered type: detectable inside a combined upload
insert into public.required_document_types
  (id, service_phase_id, slug, label_i18n, is_required, ai_extract,
   extraction_schema, detectable_in_combined)
values
  (:rdt_id::uuid, :phase_id::uuid, 'declaracion-t24',
   '{"es":"Declaración","en":"Declaration"}'::jsonb, false, true,
   '{"type":"object","properties":{"declarant_name":{"type":"string"}},"required":["declarant_name"]}'::jsonb,
   true);

insert into public.cases
  (id, org_id, case_number, service_id, service_plan_id, primary_client_id, status)
values
  (:case_id::uuid, :org_id::uuid, 'T24-CASE-A', :service_id::uuid, :svc_plan_id::uuid,
   :client_id::uuid, 'active');

insert into public.case_members (case_id, user_id, access_role)
values (:case_id::uuid, :client_id::uuid, 'owner');

-- source upload (the combined PDF)
insert into public.case_documents
  (id, case_id, uploaded_by, storage_path, original_filename, mime_type, size_bytes)
values
  (:case_doc_id::uuid, :case_id::uuid, :client_id::uuid,
   'case/f2400000-0000-0000-0000-000000c00800/i589_t24.pdf',
   'i589_t24.pdf', 'application/pdf', 2048);

-- coverage row — inserted by postgres (service_role equivalent, the job's path)
insert into public.case_document_coverages
  (id, case_id, case_document_id, covered_required_document_type_id,
   status, confidence, payload)
values
  (:coverage_id::uuid, :case_id::uuid, :case_doc_id::uuid, :rdt_id::uuid,
   'detected', 0.90, '{"declarant_name":"Juan"}'::jsonb);

-- ── T24a + T24c + T24e: ADMIN ────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f2400000-0000-0000-0000-000000c00200',
  'role',      'authenticated',
  'org_id',    'f2400000-0000-0000-0000-000000c00100',
  'user_kind', 'staff',
  'user_role', 'admin'
)::text, true);

select is_empty(
  $$ select id from public.case_document_coverages $$,
  'T24a: admin sees 0 case_document_coverages (zero policies — service_role only)'
);

select throws_ok(
  $$ insert into public.case_document_coverages
       (case_id, case_document_id, covered_required_document_type_id, status, confidence)
     values (
       'f2400000-0000-0000-0000-000000c00800'::uuid,
       'f2400000-0000-0000-0000-000000c00900'::uuid,
       'f2400000-0000-0000-0000-000000c00700'::uuid,
       'detected', 0.99
     ) $$,
  '42501',
  null,
  'T24c: admin cannot INSERT a coverage (P-SERVICE-ROLE-ONLY)'
);

select is_empty(
  $$ update public.case_document_coverages
        set status = 'dismissed'
      where id = 'f2400000-0000-0000-0000-000000c00a00'::uuid
      returning id $$,
  'T24e: admin cannot UPDATE a coverage (no policy → 0 rows)'
);

-- ── T24b + T24d + T24f: CLIENT (case owner) ──────────────────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f2400000-0000-0000-0000-000000c00300',
  'role',      'authenticated',
  'org_id',    'f2400000-0000-0000-0000-000000c00100',
  'user_kind', 'client',
  'user_role', null
)::text, true);

select is_empty(
  $$ select id from public.case_document_coverages $$,
  'T24b: client (case owner) sees 0 coverages (reads only via gated DTOs)'
);

select throws_ok(
  $$ insert into public.case_document_coverages
       (case_id, case_document_id, covered_required_document_type_id, status, confidence)
     values (
       'f2400000-0000-0000-0000-000000c00800'::uuid,
       'f2400000-0000-0000-0000-000000c00900'::uuid,
       'f2400000-0000-0000-0000-000000c00700'::uuid,
       'detected', 0.99
     ) $$,
  '42501',
  null,
  'T24d: client cannot INSERT a coverage — the forms gate cannot be self-opened'
);

select is_empty(
  $$ delete from public.case_document_coverages
      where id = 'f2400000-0000-0000-0000-000000c00a00'::uuid
      returning id $$,
  'T24f: client cannot DELETE a coverage (no policy → 0 rows)'
);

select * from finish();
rollback;
