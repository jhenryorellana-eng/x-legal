-- ============================================================
-- 0023_service_party_roles.sql
-- Per-service case party/role definitions (DOC-41).
-- The admin declares, per service, which ADDITIONAL parties a case has
-- (besides the applicant) — e.g. "Hijos" (multiple), "Cónyuge" (single) — each
-- with a friendly label + cardinality. Vanessa's "Nuevo caso" modal then only
-- offers these roles (no free text), and per-party documents reference them.
-- The applicant/"solicitante" is implicit (auto-added with role 'petitioner').
-- role_key mirrors the case_parties.party_role CHECK (0004_cases.sql) — no enum change.
-- Depends on: 0002_catalog
-- ============================================================

create table public.service_party_roles (
  id          uuid        primary key default gen_random_uuid(),
  service_id  uuid        not null references public.services(id) on delete cascade,
  role_key    text        not null check (role_key in (
                            'beneficiary', 'petitioner', 'minor', 'spouse',
                            'guardian', 'witness', 'member', 'other'
                          )),
  label_i18n  jsonb       not null,
  cardinality text        not null default 'single' check (cardinality in ('single', 'multiple')),
  is_required boolean     not null default false,
  position    integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (service_id, role_key)
);
comment on table public.service_party_roles is 'Additional case parties per service (besides the implicit applicant). role_key mirrors case_parties.party_role; cardinality single|multiple.';

drop trigger if exists trg_service_party_roles_updated_at on public.service_party_roles;
create trigger trg_service_party_roles_updated_at
  before update on public.service_party_roles
  for each row execute function public.set_updated_at();

-- ── RLS (mirrors service_phases) ──────────────────────────────────────────────
alter table public.service_party_roles enable row level security;

-- SELECT: catalog editors always; otherwise only for active+public services
-- (so the client app / sales can read the roles when building a case).
create policy service_party_roles_select on public.service_party_roles
  for select to authenticated
  using (
    exists (
      select 1 from public.services s
       where s.id = service_id
         and s.org_id = (select public.auth_org_id())
         and (
           (select public.has_module('catalog', false))
           or (s.is_active and s.archived_at is null)
         )
    )
  );

create policy service_party_roles_insert on public.service_party_roles
  for insert to authenticated
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy service_party_roles_update on public.service_party_roles
  for update to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  )
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );

-- DELETE: catalog editors may remove a role definition (config only; existing
-- case_parties store the role_key string independently and are unaffected).
create policy service_party_roles_delete on public.service_party_roles
  for delete to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );
