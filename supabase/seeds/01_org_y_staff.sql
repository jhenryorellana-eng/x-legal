-- =============================================================================
-- 01_org_y_staff.sql
-- Bootstrap: org + 4 staff + module permissions + terms_versions + cover_templates
--            + lead_categories
-- Idempotent: all inserts use ON CONFLICT DO NOTHING (or DO UPDATE where noted).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- §4.1 — auth.users bootstrap (LOCAL only)
-- In prod/staging, users are created via scripts/bootstrap-staff.mjs
-- (auth.admin.createUser API). The seed resolves UUIDs by email.
-- In local dev, we insert directly into auth.users — guarded by environment check.
-- ---------------------------------------------------------------------------
do $$ begin
  if current_setting('app.environment', true) = 'production' then
    raise notice '01_org_y_staff.sql: skipping auth.users direct insert (production). '
                 'Run scripts/bootstrap-staff.mjs to create auth users first.';
  else
    -- Local / staging: create auth.users rows if they do not exist yet.
    -- Passwords are placeholders; staff must reset via email link.
    insert into auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      role,
      aud,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data
    )
    values
      (
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'henry@usalatinoprime.com',
        crypt('changeme-henry!', gen_salt('bf')),
        now(),
        'authenticated',
        'authenticated',
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb
      ),
      (
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000000',
        'vanessa@usalatinoprime.com',
        crypt('changeme-vanessa!', gen_salt('bf')),
        now(),
        'authenticated',
        'authenticated',
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb
      ),
      (
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000000',
        'diana@usalatinoprime.com',
        crypt('changeme-diana!', gen_salt('bf')),
        now(),
        'authenticated',
        'authenticated',
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb
      ),
      (
        '00000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000000',
        'andrium@usalatinoprime.com',
        crypt('changeme-andrium!', gen_salt('bf')),
        now(),
        'authenticated',
        'authenticated',
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb
      )
    on conflict (id) do nothing;

    -- GoTrue scans these string columns as NON-nullable; direct inserts leave
    -- them NULL and every Auth API call then 500s ("Database error querying
    -- schema"). Normalize to empty strings.
    update auth.users set
      confirmation_token         = coalesce(confirmation_token, ''),
      recovery_token             = coalesce(recovery_token, ''),
      email_change               = coalesce(email_change, ''),
      email_change_token_new     = coalesce(email_change_token_new, ''),
      email_change_token_current = coalesce(email_change_token_current, ''),
      phone_change               = coalesce(phone_change, ''),
      phone_change_token         = coalesce(phone_change_token, ''),
      reauthentication_token     = coalesce(reauthentication_token, '')
    where id in (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000004'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- §4.2 — Org única
-- ---------------------------------------------------------------------------
insert into public.orgs (name, settings)
values (
  'UsaLatinoPrime',
  jsonb_build_object(
    'contact_phone',    '+10000000000',          -- TODO(Henry): teléfono real de contacto
    'contact_whatsapp', '+10000000000',          -- TODO(Henry): WhatsApp real
    'default_timezone', 'America/New_York',
    'ai_budget_usd',    300,                     -- monthly AI budget alert (not a hard cut)
    'retention_years',  7,
    'metric_goals', jsonb_build_object(
      'first_contact_min', 15,                   -- goal: first contact to lead < 15 min
      'attendance_pct',    80                    -- goal: appointment attendance >= 80%
    )
  )
)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- §4.3 — Users (public.users — 1:1 with auth.users, resolved by email)
-- ---------------------------------------------------------------------------

-- Henry (admin)
with au as (select id from auth.users where email = 'henry@usalatinoprime.com'),
     o  as (select id from public.orgs where name = 'UsaLatinoPrime')
insert into public.users (id, org_id, kind, email, locale, timezone)
select au.id, o.id, 'staff', 'henry@usalatinoprime.com', 'es', 'America/New_York'
from au, o
on conflict (id) do nothing;

-- Vanessa (sales)
with au as (select id from auth.users where email = 'vanessa@usalatinoprime.com'),
     o  as (select id from public.orgs where name = 'UsaLatinoPrime')
insert into public.users (id, org_id, kind, email, locale, timezone)
select au.id, o.id, 'staff', 'vanessa@usalatinoprime.com', 'es', 'America/New_York'
from au, o
on conflict (id) do nothing;

-- Diana (paralegal)
with au as (select id from auth.users where email = 'diana@usalatinoprime.com'),
     o  as (select id from public.orgs where name = 'UsaLatinoPrime')
insert into public.users (id, org_id, kind, email, locale, timezone)
select au.id, o.id, 'staff', 'diana@usalatinoprime.com', 'es', 'America/New_York'
from au, o
on conflict (id) do nothing;

-- Andrium (finance)
with au as (select id from auth.users where email = 'andrium@usalatinoprime.com'),
     o  as (select id from public.orgs where name = 'UsaLatinoPrime')
insert into public.users (id, org_id, kind, email, locale, timezone)
select au.id, o.id, 'staff', 'andrium@usalatinoprime.com', 'es', 'America/New_York'
from au, o
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- §4.3 — staff_profiles
-- ---------------------------------------------------------------------------

insert into public.staff_profiles (user_id, role, display_name, title_i18n)
select id, 'admin', 'Henry', '{"es":"Director","en":"Director"}'::jsonb
from auth.users where email = 'henry@usalatinoprime.com'
on conflict (user_id) do nothing;

insert into public.staff_profiles (user_id, role, display_name, title_i18n)
select id, 'sales', 'Vanessa', '{"es":"Asesora de ventas","en":"Sales Advisor"}'::jsonb
from auth.users where email = 'vanessa@usalatinoprime.com'
on conflict (user_id) do nothing;

insert into public.staff_profiles (user_id, role, display_name, title_i18n)
select id, 'paralegal', 'Diana', '{"es":"Gestora Documental","en":"Case Processor"}'::jsonb
from auth.users where email = 'diana@usalatinoprime.com'
on conflict (user_id) do nothing;

insert into public.staff_profiles (user_id, role, display_name, title_i18n)
select id, 'finance', 'Andrium', '{"es":"Finanzas y operaciones","en":"Finance and Operations"}'::jsonb
from auth.users where email = 'andrium@usalatinoprime.com'
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- §4.4 — employee_module_permissions
-- Matrix from DOC-22 §6. Admin (Henry) has bypass-all => no rows needed.
-- E = view + edit (can_view=true, can_edit=true)
-- V = view only  (can_view=true, can_edit=false)
-- Modules not listed => denied (no row = no access)
-- ---------------------------------------------------------------------------

-- sales (Vanessa)
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit)
select sp.user_id, m.module_key, m.can_view, m.can_edit
from public.staff_profiles sp
cross join (values
  ('dashboard',   true,  false),   -- V
  ('leads',       true,  true),    -- E
  ('clients',     true,  false),   -- V
  ('cases',       true,  false),   -- V
  ('calendar',    true,  true),    -- E
  ('availability',true,  true),    -- E
  ('metrics',     true,  false),   -- V
  ('messaging',   true,  true)     -- E
) as m(module_key, can_view, can_edit)
where sp.role = 'sales'
on conflict (staff_id, module_key) do nothing;

-- paralegal (Diana)
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit)
select sp.user_id, m.module_key, m.can_view, m.can_edit
from public.staff_profiles sp
cross join (values
  ('dashboard',    true,  false),  -- V
  ('clients',      true,  false),  -- V
  ('cases',        true,  true),   -- E
  ('calendar',     true,  false),  -- V
  ('expedientes',  true,  true),   -- E
  ('validations',  true,  true),   -- E
  ('messaging',    true,  true)    -- E
) as m(module_key, can_view, can_edit)
where sp.role = 'paralegal'
on conflict (staff_id, module_key) do nothing;

-- finance (Andrium)
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit)
select sp.user_id, m.module_key, m.can_view, m.can_edit
from public.staff_profiles sp
cross join (values
  ('dashboard',    true,  false),  -- V
  ('clients',      true,  false),  -- V
  ('cases',        true,  false),  -- V
  ('billing',      true,  true),   -- E
  ('collections',  true,  true),   -- E
  ('printing',     true,  true),   -- E
  ('campaigns',    true,  true),   -- E
  ('accounting',   true,  true),   -- E
  ('expedientes',  true,  false),  -- V
  ('messaging',    true,  true)    -- E
  -- community: E (Andrium manages campaigns; community is Andrium per the matrix)
  -- TODO(SoT): DOC-32 §4.4 matrix shows 'community' = E for finance but DOC-22 §6
  -- matrix column header says "campaigns/community" for Andrium. Verify if
  -- 'community' module should be a separate E row for finance. Currently included:
) as m(module_key, can_view, can_edit)
where sp.role = 'finance'
on conflict (staff_id, module_key) do nothing;

-- Add community E for finance (Andrium) — per DOC-32 §4.4 matrix
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit)
select sp.user_id, 'community', true, true
from public.staff_profiles sp
where sp.role = 'finance'
on conflict (staff_id, module_key) do nothing;

-- ---------------------------------------------------------------------------
-- §4.5 — terms_versions v1.0
-- ---------------------------------------------------------------------------
insert into public.terms_versions (org_id, version, title_i18n, body_md_i18n, is_active, published_at)
select o.id, 'v1.0',
  '{"es":"Términos del servicio y aviso legal","en":"Terms of Service and Legal Notice"}'::jsonb,
  jsonb_build_object(
    'es', E'## 1. Naturaleza del servicio\n(UsaLatinoPrime no es un bufete de abogados…)\n\n'
          '## 2. Alcance del servicio contratado\n…\n\n'
          '## 3. Pagos, cuotas y reembolsos\n…\n\n'
          '## 4. Privacidad y manejo de documentos\n…\n\n'
          '## 5. Comunicaciones y firma electrónica\n…',
    'en', E'## 1. Nature of the service\n…\n\n'
          '## 2. Scope of the contracted service\n…\n\n'
          '## 3. Payments, installments and refunds\n…\n\n'
          '## 4. Privacy and document handling\n…\n\n'
          '## 5. Communications and e-signature\n…'
  ),
  true, now()
from public.orgs o
where o.name = 'UsaLatinoPrime'
on conflict (org_id, version) do nothing;
-- TODO(Henry): the definitive legal text for all 5 sections must be provided
-- by the business owner BEFORE going to production.

-- ---------------------------------------------------------------------------
-- §4.6 — cover_templates base
-- ---------------------------------------------------------------------------
insert into public.cover_templates (org_id, name, template, is_active)
select o.id, t.name, t.template, true
from public.orgs o
cross join (values
  ('Carátula estándar ULP',
   '{"title_i18n":{"es":"Expediente legal","en":"Legal file"},"fields":["case_number","client_name","service_label","filing_date"],"style":"ulp-classic"}'::jsonb),
  ('Separador de sección',
   '{"title_i18n":{"es":"Sección","en":"Section"},"fields":["section_title","item_count"],"style":"ulp-divider"}'::jsonb)
) as t(name, template)
where o.name = 'UsaLatinoPrime'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- §4.7 — lead_categories seed
-- ---------------------------------------------------------------------------
insert into public.lead_categories (org_id, label, color, position)
select o.id, c.label, c.color, c.position
from public.orgs o
cross join (values
  ('Caliente', 'red',    1),
  ('Tibio',    'gold',   2),
  ('Frío',     'navy',   3),
  ('VIP',      'purple', 4)
) as c(label, color, position)
where o.name = 'UsaLatinoPrime'
on conflict (org_id, label) do nothing;
