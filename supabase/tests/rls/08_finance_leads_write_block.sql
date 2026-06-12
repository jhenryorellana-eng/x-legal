-- =============================================================================
-- 08_finance_leads_write_block.sql
-- DOC-31 §8.2 — Test 9
--
-- Asserts: Finance staff (role='finance') cannot INSERT or UPDATE leads.
--
-- The `leads` table policy requires `has_module('leads', true)` for INSERT/UPDATE.
-- Finance staff has NO 'leads' row in employee_module_permissions (DOC-22 §6
-- default matrix: finance column for leads is "-"). Therefore:
--   - Finance cannot INSERT a lead (42501).
--   - Finance cannot UPDATE an existing lead (42501).
--   - Finance cannot even SELECT leads (0 rows) — no leads module at all.
--
-- For the positive control, sales staff (has leads=E) CAN read and INSERT.
--
-- Fixtures (all UUIDs prefix f8…):
--   Org O8          (…h00100)
--   Finance staff   (…h00200) — role=finance, has billing E, NO leads
--   Sales staff     (…h00300) — role=sales, has leads E (positive control)
--   Lead            (…h00400) — inserted by postgres so table is not empty
--   Service         (…h00500) — for leads.interested_service_id (nullable FK)
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;

-- 6 assertions:
--   T9a: finance sees 0 leads (no leads module)
--   T9b: finance cannot INSERT a lead (42501)
--   T9c: finance cannot UPDATE existing lead (42501)
--   T9d (positive): sales sees 1 lead (has leads module)
--   T9e (positive): sales can INSERT a lead (lives_ok)
--   T9f: view-only staff (leads can_view=true, can_edit=false) cannot INSERT lead (42501)
select plan(6);

-- ── UUIDs ────────────────────────────────────────────────────────────────────
\set org_id       '''f8000000-0000-0000-0000-000000h00100'''
\set finance_id   '''f8000000-0000-0000-0000-000000h00200'''
\set sales_id     '''f8000000-0000-0000-0000-000000h00300'''
\set lead_id      '''f8000000-0000-0000-0000-000000h00400'''
\set service_id   '''f8000000-0000-0000-0000-000000h00500'''
\set viewonly_id  '''f8000000-0000-0000-0000-000000h00600'''

-- ── Fixtures (postgres = bypass RLS) ─────────────────────────────────────────

insert into auth.users (
  id, instance_id, aud, role, email, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  (:finance_id::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'finance_t8@test.invalid',  now(), now(), '', '', '', '', '', '', '', ''),
  (:sales_id::uuid,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sales_t8@test.invalid',    now(), now(), '', '', '', '', '', '', '', ''),
  (:viewonly_id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'viewonly_t8@test.invalid', now(), now(), '', '', '', '', '', '', '', '');

insert into public.orgs (id, name)
values (:org_id::uuid, 'TestOrg_T8');

insert into public.users (id, org_id, kind, is_active) values
  (:finance_id::uuid,  :org_id::uuid, 'staff', true),
  (:sales_id::uuid,    :org_id::uuid, 'staff', true),
  (:viewonly_id::uuid, :org_id::uuid, 'staff', true);

insert into public.staff_profiles (user_id, role, display_name) values
  (:finance_id::uuid,  'finance',   'Finance_T8'),
  (:sales_id::uuid,    'sales',     'Sales_T8'),
  (:viewonly_id::uuid, 'paralegal', 'ViewOnly_T8');

-- Finance: billing E — intentionally NO leads row
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit) values
  (:finance_id::uuid, 'billing', true, true);

-- Sales: leads E (can insert and update leads)
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit) values
  (:sales_id::uuid, 'leads', true, true);

-- View-only staff: leads V (can_view=true, can_edit=false)
-- Used in T9f to verify that view-only cannot INSERT
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit) values
  (:viewonly_id::uuid, 'leads', true, false);

-- Service (optional FK on leads.interested_service_id; we create it to allow
-- a realistic lead fixture without leaving it NULL)
insert into public.services (id, org_id, slug, category, label_i18n, is_active)
values (:service_id::uuid, :org_id::uuid, 'svc-t8', 'migratorio',
        '{"es":"Servicio T8","en":"Service T8"}'::jsonb, true);

-- Lead inserted as postgres (bypass). phone_e164 is NOT NULL on the real schema.
insert into public.leads (id, org_id, phone_e164, full_name, status, interested_service_id)
values (:lead_id::uuid, :org_id::uuid, '+15551234567', 'Lead T8', 'open', :service_id::uuid);

-- ── T9a-c: Finance cannot read or write leads ─────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f8000000-0000-0000-0000-000000h00200',
  'role',      'authenticated',
  'org_id',    'f8000000-0000-0000-0000-000000h00100',
  'user_kind', 'staff',
  'user_role', 'finance'
)::text, true);

-- T9a: finance sees 0 leads (no leads module at all)
select is_empty(
  $$ select id from public.leads $$,
  'T9a: finance staff without leads module sees 0 leads'
);

-- T9b: finance cannot INSERT a lead (42501 — no leads module)
select throws_ok(
  $$ insert into public.leads (org_id, phone_e164, full_name, status)
     values (
       'f8000000-0000-0000-0000-000000h00100'::uuid,
       '+15559990001',
       'Injected Lead', 'open'
     ) $$,
  '42501',
  null,
  'T9b: finance staff cannot INSERT leads (no leads module)'
);

-- T9c: finance cannot UPDATE an existing lead (42501 — no leads module)
select throws_ok(
  $$ update public.leads
     set full_name = 'Hacked'
     where id = 'f8000000-0000-0000-0000-000000h00400'::uuid $$,
  '42501',
  null,
  'T9c: finance staff cannot UPDATE leads (no leads module)'
);

-- ── T9d-e: Sales (leads=E) — positive path ────────────────────────────────────
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f8000000-0000-0000-0000-000000h00300',
  'role',      'authenticated',
  'org_id',    'f8000000-0000-0000-0000-000000h00100',
  'user_kind', 'staff',
  'user_role', 'sales'
)::text, true);

-- T9d: sales sees 1 lead (has leads module)
select results_eq(
  $$ select count(*)::bigint from public.leads $$,
  $$ values (1::bigint) $$,
  'T9d: sales staff with leads module sees leads'
);

-- T9e: sales can INSERT a lead (leads=E)
select lives_ok(
  $$ insert into public.leads (org_id, phone_e164, full_name, status)
     values (
       'f8000000-0000-0000-0000-000000h00100'::uuid,
       '+15559990002',
       'Sales Inserted Lead', 'open'
     ) $$,
  'T9e: sales staff with leads edit can INSERT a lead'
);

-- ── T9f: View-only staff (leads can_view=true, can_edit=false) cannot INSERT ──
set local role postgres;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub',       'f8000000-0000-0000-0000-000000h00600',
  'role',      'authenticated',
  'org_id',    'f8000000-0000-0000-0000-000000h00100',
  'user_kind', 'staff',
  'user_role', 'paralegal'
)::text, true);

-- T9f: view-only staff cannot INSERT a lead (needs can_edit)
select throws_ok(
  $$ insert into public.leads (org_id, phone_e164, full_name, status)
     values (
       'f8000000-0000-0000-0000-000000h00100'::uuid,
       '+15559990003',
       'ViewOnly Injected', 'open'
     ) $$,
  '42501',
  null,
  'T9f: staff with leads can_view only cannot INSERT leads (needs can_edit)'
);

select * from finish();
rollback;
