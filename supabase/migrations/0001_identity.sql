-- ============================================================
-- 0001_identity.sql
-- Block: identity (6 tables)
-- Extensions, base functions, auth hook, RLS helpers
-- Depends on: nothing
-- ============================================================

-- ── Extensions ────────────────────────────────────────────────────────────────
create extension if not exists pg_trgm;
-- btree_gist is required for the EXCLUDE constraint on appointments (0007)
create extension if not exists btree_gist;

-- ── Base functions ─────────────────────────────────────────────────────────────

-- Trigger function: keeps updated_at current (defined once, reused by all tables)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Phone normalization to E.164 (mirrors frontend normalize_phone in identity/domain.ts)
-- Assumes US default (+1). For real production use, replace with a proper lib or regex.
create or replace function public.normalize_phone(raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits text;
begin
  -- strip everything except digits
  digits := regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g');
  -- US 10-digit: prepend +1
  if length(digits) = 10 then
    return '+1' || digits;
  end if;
  -- already has country code (11 digits starting with 1)
  if length(digits) = 11 and left(digits, 1) = '1' then
    return '+' || digits;
  end if;
  -- already E.164 style passed in (starts with +)
  if left(coalesce(raw, ''), 1) = '+' and length(digits) between 7 and 15 then
    return '+' || digits;
  end if;
  return raw; -- return as-is if we cannot determine format
end;
$$;

-- ── Tables ────────────────────────────────────────────────────────────────────

-- orgs: tenant root (no org_id; IS the root)
create table public.orgs (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  settings   jsonb       not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.orgs is 'Tenant root. Settings keys: contact_phone, contact_whatsapp, default_timezone, ai_budget_usd, retention_years, metric_goals.';

drop trigger if exists trg_orgs_updated_at on public.orgs;
create trigger trg_orgs_updated_at
  before update on public.orgs
  for each row execute function public.set_updated_at();

-- users: 1:1 with auth.users (id = auth.users.id)
create table public.users (
  id               uuid        primary key references auth.users(id),
  org_id           uuid        not null references public.orgs(id),
  kind             text        not null check (kind in ('client', 'staff')),
  phone_e164       text        unique,          -- null for staff; identity of client (E.164)
  email            text,
  locale           text        not null default 'es' check (locale in ('es', 'en')),
  timezone         text        not null default 'America/New_York',
  theme            text        not null default 'light' check (theme in ('light', 'dark')),
  text_scale       numeric(3,2) not null default 1.00 check (text_scale in (0.92, 1.00, 1.12)),
  last_seen_at     timestamptz,
  email_bounced_at timestamptz,
  is_active        boolean     not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.users is 'Application users (client + staff). id = auth.users.id. phone_e164 is unique stable identity of client.';
comment on column public.users.phone_e164 is 'E.164 format. Unique where not null. Null for staff.';

create unique index users_phone_e164_idx on public.users(phone_e164) where phone_e164 is not null;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- staff_profiles: staff-specific attributes (PK = user_id)
create table public.staff_profiles (
  user_id      uuid  primary key references public.users(id) on delete cascade,
  role         text  not null check (role in ('admin', 'sales', 'paralegal', 'finance')),
  display_name text  not null,
  avatar_url   text,
  title_i18n   jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.staff_profiles is 'Staff-specific profile. role drives authorization matrix.';

drop trigger if exists trg_staff_profiles_updated_at on public.staff_profiles;
create trigger trg_staff_profiles_updated_at
  before update on public.staff_profiles
  for each row execute function public.set_updated_at();

-- client_profiles: client-specific attributes (PK = user_id)
create table public.client_profiles (
  user_id          uuid    primary key references public.users(id) on delete cascade,
  first_name       text    not null,
  last_name        text    not null,
  preferred_name   text,
  country_of_origin text,
  address          jsonb,  -- {line1, city, state, zip}
  pii_encrypted    jsonb   not null default '{}', -- {ssn?, a_number?, passport?} AES-GCM
  marketing_opt_in boolean not null default true,
  tutorial_seen_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.client_profiles is 'Client-specific profile. pii_encrypted uses AES-GCM (platform/crypto).';

-- Trigram index for fuzzy name search by staff
create index client_profiles_name_trgm_idx
  on public.client_profiles
  using gin ((first_name || ' ' || last_name) gin_trgm_ops);

drop trigger if exists trg_client_profiles_updated_at on public.client_profiles;
create trigger trg_client_profiles_updated_at
  before update on public.client_profiles
  for each row execute function public.set_updated_at();

-- person_records: physical persons who are NOT users (minors, spouses, witnesses...)
create table public.person_records (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  first_name      text not null,
  last_name       text not null,
  date_of_birth   date,
  relationship    text,   -- free text: 'son','daughter','spouse','witness'...
  country_of_birth text,
  pii_encrypted   jsonb not null default '{}',
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.person_records is 'Physical persons not in auth.users (minors, spouses, witnesses). Resolves legacy D2 (minors/spouse in JSONB).';

drop trigger if exists trg_person_records_updated_at on public.person_records;
create trigger trg_person_records_updated_at
  before update on public.person_records
  for each row execute function public.set_updated_at();

-- employee_module_permissions: per-staff module access matrix (RF-ADM-045)
create table public.employee_module_permissions (
  id         uuid    primary key default gen_random_uuid(),
  staff_id   uuid    not null references public.staff_profiles(id) on delete cascade,
  module_key text    not null,
  -- Canonical values (shared/constants/modules.ts):
  -- dashboard, leads, clients, cases, calendar, availability,
  -- metrics, catalog, datasets, employees, billing, collections,
  -- printing, campaigns, accounting, expedientes, validations,
  -- messaging, community, audit
  can_view   boolean not null default false,
  can_edit   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, module_key)
);
comment on table public.employee_module_permissions is 'Per-staff module visibility matrix. Admin bypasses this (no rows needed). RF-ADM-045: changes take effect immediately (no JWT cache).';

drop trigger if exists trg_employee_module_permissions_updated_at on public.employee_module_permissions;
create trigger trg_employee_module_permissions_updated_at
  before update on public.employee_module_permissions
  for each row execute function public.set_updated_at();

-- ── RLS helper functions ───────────────────────────────────────────────────────
-- Defined here because their tables (users, employee_module_permissions) now exist.
-- is_case_member() is deferred to 0004 (case_members table does not exist yet).

create or replace function public.auth_org_id()
returns uuid
language sql stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'org_id', '')::uuid
$$;

create or replace function public.staff_role()
returns text
language sql stable
set search_path = ''
as $$
  select case
           when auth.jwt() ->> 'user_kind' = 'staff'
           then auth.jwt() ->> 'user_role'
         end
$$;

-- is_staff(): checks JWT claim AND live is_active in users table (detects deactivated sessions)
create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() ->> 'user_kind') = 'staff'
    and exists (
      select 1
        from public.users u
       where u.id = (select auth.uid())
         and u.kind = 'staff'
         and u.is_active
         and u.org_id = public.auth_org_id()
    ), false)
$$;

create or replace function public.is_client()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() ->> 'user_kind') = 'client'
    and exists (
      select 1
        from public.users u
       where u.id = (select auth.uid())
         and u.kind = 'client'
         and u.is_active
         and u.org_id = public.auth_org_id()
    ), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_staff() and public.staff_role() = 'admin'
$$;

-- has_module(): admin bypasses entirely; others checked live against employee_module_permissions
create or replace function public.has_module(module_key text, need_edit boolean default false)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_staff()
         and (
           public.staff_role() = 'admin'
           or exists (
                select 1
                  from public.employee_module_permissions emp
                 where emp.staff_id   = (select auth.uid())
                   and emp.module_key = has_module.module_key
                   and (emp.can_edit or (not has_module.need_edit and emp.can_view))
              )
         )
$$;

-- ── Auth Hook (DOC-22 §3.2) ───────────────────────────────────────────────────
-- Custom claims: org_id, user_kind, user_role (NOT 'role' — that is reserved by Supabase/PostgREST)
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  u record;
begin
  select usr.org_id, usr.kind, sp.role
    into u
    from public.users usr
    left join public.staff_profiles sp on sp.user_id = usr.id
   where usr.id = (event->>'user_id')::uuid;

  claims := event->'claims';

  if u.org_id is not null then
    claims := jsonb_set(claims, '{org_id}',    to_jsonb(u.org_id::text));
    claims := jsonb_set(claims, '{user_kind}', to_jsonb(u.kind));
    claims := jsonb_set(claims, '{user_role}', coalesce(to_jsonb(u.role), 'null'::jsonb));
  else
    -- auth user without a row in public.users (provisioning window §1.2):
    -- no custom claims => no guard passes, no policy matches.
    claims := jsonb_set(claims, '{user_kind}', '"unprovisioned"');
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Grants required by the hook (runs as supabase_auth_admin)
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
grant select on table public.users, public.staff_profiles to supabase_auth_admin;

-- Revoke from everyone else (hook is not a user-callable function)
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- Activation of the hook is done in config.toml + Supabase dashboard (not SQL):
-- [auth.hook.custom_access_token]
-- enabled = true
-- uri = "pg-functions://postgres/public/custom_access_token_hook"

-- ── Grants for helper functions ───────────────────────────────────────────────
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.auth_org_id(),
  public.staff_role(),
  public.is_staff(),
  public.is_client(),
  public.is_admin(),
  public.has_module(text, boolean),
  public.normalize_phone(text)
to authenticated;
-- is_case_member and is_conversation_participant will be granted in 0004 and 0010 respectively

-- ── RLS: enable on all tables in this block ────────────────────────────────────

alter table public.orgs                      enable row level security;
alter table public.users                     enable row level security;
alter table public.staff_profiles            enable row level security;
alter table public.client_profiles           enable row level security;
alter table public.person_records            enable row level security;
alter table public.employee_module_permissions enable row level security;

-- ── Policies: orgs ─────────────────────────────────────────────────────────────
-- SELECT: any authenticated user of the org reads their own org row (contacts, UI settings)
create policy orgs_select on public.orgs
  for select to authenticated
  using ( id = (select public.auth_org_id()) );

-- INSERT: service_role only (no new org creation in product V2.0)
-- UPDATE: admin only
create policy orgs_update on public.orgs
  for update to authenticated
  using      ( (select public.is_admin()) and id = (select public.auth_org_id()) )
  with check ( (select public.is_admin()) and id = (select public.auth_org_id()) );
-- DELETE: denied (no policy)

-- ── Policies: users ────────────────────────────────────────────────────────────
-- SELECT: own row OR staff sees staff (roster) OR staff with clients module sees clients
create policy users_select on public.users
  for select to authenticated
  using (
    id = (select auth.uid())
    or (
      org_id = (select public.auth_org_id())
      and (
        (kind = 'staff' and (select public.is_staff()))
        or (kind = 'client' and (select public.has_module('clients', false)))
      )
    )
  );

-- INSERT: service_role only (provisioned via identity service, not direct SQL by authenticated)
-- UPDATE: own row (limited columns via GRANT - see N2) OR admin
create policy users_update on public.users
  for update to authenticated
  using      ( id = (select auth.uid()) or (select public.is_admin()) )
  with check ( id = (select auth.uid()) or (select public.is_admin()) );

-- DELETE: denied (retention; deactivation = is_active=false)

-- Column-level GRANT: clients can only update their own locale/timezone/theme/text_scale/email
-- is_active, phone_e164, kind, org_id require admin (no grant for authenticated non-admin)
revoke update on public.users from authenticated;
grant update (locale, timezone, theme, text_scale, email) on public.users to authenticated;

-- ── Policies: staff_profiles ───────────────────────────────────────────────────
-- SELECT: any active user of the org (client sees team names/avatars for messaging/roster)
create policy staff_profiles_select on public.staff_profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
       where u.id = user_id
         and u.org_id = (select public.auth_org_id())
    )
    and ((select public.is_staff()) or (select public.is_client()))
  );

-- INSERT: admin (normal path is service_role via inviteEmployee)
create policy staff_profiles_insert on public.staff_profiles
  for insert to authenticated
  with check ( (select public.is_admin()) );

-- UPDATE: own profile (display_name/avatar_url) OR admin (role, title)
create policy staff_profiles_update on public.staff_profiles
  for update to authenticated
  using      ( user_id = (select auth.uid()) or (select public.is_admin()) )
  with check ( user_id = (select auth.uid()) or (select public.is_admin()) );

-- DELETE: service_role only (cascade from users; no product deletion)

-- ── Policies: client_profiles ──────────────────────────────────────────────────
-- SELECT: own row OR staff with clients module
create policy client_profiles_select on public.client_profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_module('clients', false))
  );

-- INSERT: service_role only (provisioned in Paso 1 of modal "Nuevo caso")
-- UPDATE: own row (limited columns via GRANT) OR staff with clients edit
create policy client_profiles_update on public.client_profiles
  for update to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_module('clients', true))
  )
  with check (
    user_id = (select auth.uid())
    or (select public.has_module('clients', true))
  );

-- DELETE: denied (purge = service_role process per DOC-27)

-- Column GRANT: clients can update preferred_name, address, marketing_opt_in, tutorial_seen_at
-- pii_encrypted: NO grant for authenticated (only platform/crypto via service_role)
revoke update on public.client_profiles from authenticated;
grant update (preferred_name, address, marketing_opt_in, tutorial_seen_at) on public.client_profiles to authenticated;

-- ── Policies: person_records ───────────────────────────────────────────────────
-- SELECT: staff with cases module OR client sees people in THEIR cases (via case_parties)
-- Note: is_case_member() doesn't exist yet; the subquery below mirrors its logic at this stage.
-- When 0004 creates case_members, the function is_case_member() will be added and policies
-- that reference case_members will use it.
create policy person_records_select on public.person_records
  for select to authenticated
  using (
    (org_id = (select public.auth_org_id()) and (select public.has_module('cases', false)))
    or exists (
      -- Client sees persons linked to their own cases (their minors/spouse)
      -- case_parties and case_members don't exist yet but this policy runs after 0004 is applied
      -- During 0001 bootstrap, this subquery will return false until 0004 creates the tables.
      -- TODO(SoT): Verify this forward-reference behavior is acceptable in Supabase (policy compiled at query time)
      select 1 from public.case_parties cp
       where cp.person_record_id = person_records.id
         and exists (
           select 1 from public.case_members cm
            where cm.case_id = cp.case_id
              and cm.user_id = (select auth.uid())
         )
    )
  );

-- INSERT: staff with cases edit
create policy person_records_insert on public.person_records
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('cases', true))
    and created_by = (select auth.uid())
  );

-- UPDATE: staff with cases edit (pii_encrypted: no grant for authenticated)
create policy person_records_update on public.person_records
  for update to authenticated
  using      ( org_id = (select public.auth_org_id()) and (select public.has_module('cases', true)) )
  with check ( org_id = (select public.auth_org_id()) and (select public.has_module('cases', true)) );

-- DELETE: admin only (cleanup of erroneously captured persons with no linked parties; FK restrict protects)
create policy person_records_delete on public.person_records
  for delete to authenticated
  using ( (select public.is_admin()) and org_id = (select public.auth_org_id()) );

-- ── Policies: employee_module_permissions ──────────────────────────────────────
-- SELECT: own rows (staff loads own permissions on login) OR admin (matrix management)
create policy emp_perms_select on public.employee_module_permissions
  for select to authenticated
  using ( staff_id = (select auth.uid()) or (select public.is_admin()) );

-- INSERT/UPDATE/DELETE: admin only (RF-ADM-045; initial setup may be service_role via inviteEmployee)
create policy emp_perms_insert on public.employee_module_permissions
  for insert to authenticated
  with check ( (select public.is_admin()) );

create policy emp_perms_update on public.employee_module_permissions
  for update to authenticated
  using      ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

create policy emp_perms_delete on public.employee_module_permissions
  for delete to authenticated
  using ( (select public.is_admin()) );
