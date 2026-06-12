-- ============================================================
-- 0005_contracts.sql
-- Block: contracts (3 tables)
-- Includes special public signing_token flow (DOC-31, DOC-22 §4)
-- Depends on: 0001, 0002, 0003, 0004
-- ============================================================

-- ── terms_versions ────────────────────────────────────────────────────────────
-- Versioned T&C content. Only 1 active per org at any time (partial unique index).
create table public.terms_versions (
  id             uuid    primary key default gen_random_uuid(),
  org_id         uuid    not null references public.orgs(id),
  version        text    not null,          -- 'v1.0', 'v1.1'...
  title_i18n     jsonb   not null,
  body_md_i18n   jsonb   not null,          -- markdown ES/EN, 5 sections
  is_active      boolean not null default false,
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, version)
);
comment on table public.terms_versions is 'Versioned Terms & Conditions content. The partial unique index enforces at most 1 active version per org.';

-- Partial unique index: at most 1 active version per org
create unique index terms_versions_one_active_per_org_idx
  on public.terms_versions(org_id)
  where is_active = true;

drop trigger if exists trg_terms_versions_updated_at on public.terms_versions;
create trigger trg_terms_versions_updated_at
  before update on public.terms_versions
  for each row execute function public.set_updated_at();

-- ── contracts ─────────────────────────────────────────────────────────────────
-- Special case: the signing_token public flow (DOC-22 §4, DOC-31 §4).
-- The /firma/[token] page does NOT use authenticated RLS: it uses service_role
-- with a precise token lookup. NO policy for anon exists here.
create table public.contracts (
  id                  uuid    primary key default gen_random_uuid(),
  org_id              uuid    not null references public.orgs(id),
  case_id             uuid    unique references public.cases(id),           -- 1:1 (legacy jewel)
  lead_id             uuid    references public.leads(id),
  service_id          uuid    not null references public.services(id),
  service_plan_id     uuid    not null references public.service_plans(id),
  plan_snapshot       jsonb   not null,      -- price/conditions at signing time
  parties_snapshot    jsonb   not null,      -- parties declared (live truth is case_parties)
  status              text    not null default 'draft'
                        check (status in ('draft', 'sent', 'signed', 'cancelled')),
  signing_token       uuid    unique default gen_random_uuid(),  -- public signing link token (expires)
  signing_expires_at  timestamptz,
  signed_pdf_path     text,                  -- bucket 'contracts'
  signature_image_path text,
  signed_at           timestamptz,
  signed_ip           inet,
  created_by          uuid    references public.staff_profiles(id),
  terms_version       text,                  -- T&C version included at signing
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.contracts is '1:1 with cases (legacy jewel). signing_token enables the public /firma/[token] flow — NOT via authenticated RLS; consumed via service_role in contracts/service.ts. Token is nulled on signing (single-use).';
comment on column public.contracts.signing_token is 'UUID v4 ~122-bit token. Single-use: nulled after signing. Rate limit: signing:token:ip 30/hr.';
comment on column public.contracts.case_id is '1:1 with cases (UNIQUE). null while contract is in draft/sent pre-case-creation flow.';

drop trigger if exists trg_contracts_updated_at on public.contracts;
create trigger trg_contracts_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

-- ── contract_terms_acceptances ────────────────────────────────────────────────
-- In-app disclaimer acceptance (first login after case activation)
create table public.contract_terms_acceptances (
  id                   uuid    primary key default gen_random_uuid(),
  case_id              uuid    not null references public.cases(id) on delete cascade,
  user_id              uuid    not null references public.users(id),
  terms_version        text    not null,
  signature_image_path text    not null,      -- drawn or uploaded via SignaturePad
  accepted_at          timestamptz not null default now(),
  ip                   inet,
  created_at           timestamptz not null default now(),
  -- No updated_at: legal evidence, immutable
  unique (case_id, user_id, terms_version)
);
comment on table public.contract_terms_acceptances is 'In-app T&C acceptance at first login after case activation. Immutable legal evidence.';

-- ── RLS: enable on all tables in this block ───────────────────────────────────
alter table public.terms_versions             enable row level security;
alter table public.contracts                  enable row level security;
alter table public.contract_terms_acceptances enable row level security;

-- ── Policies: terms_versions ──────────────────────────────────────────────────
-- Active version readable by any authenticated user (client renders disclaimer on first login)
-- Historical versions: admin only
-- Signing page render: service_role (no anon policy; contracts/service.ts uses service client)
create policy terms_versions_select on public.terms_versions
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (is_active or (select public.is_admin()))
  );

create policy terms_versions_insert on public.terms_versions
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.is_admin())
  );

create policy terms_versions_update on public.terms_versions
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.is_admin())
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.is_admin())
  );
-- DELETE: denied (permanent versioning)

-- ── Policies: contracts ───────────────────────────────────────────────────────
-- IMPORTANT: NO policy for anon (signing_token flow uses service_role only)
-- An attacker with the anon key cannot even attempt a token lookup against the DB.

-- SELECT: commercial/operational/finance staff OR client seeing THEIR signed contract (PDF download)
create policy contracts_select on public.contracts
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (
      (select public.has_module('leads', false))
      or (select public.has_module('cases', false))
      or (select public.has_module('billing', false))
      or (
        case_id is not null
        and status = 'signed'
        and (select public.is_case_member(case_id))
      )
    )
  );

-- INSERT/UPDATE: Vanessa (leads or cases edit module) creates/sends/resends
-- Token rotation and actual signing go through service_role
create policy contracts_insert on public.contracts
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (
      (select public.has_module('leads', true))
      or (select public.has_module('cases', true))
    )
  );

create policy contracts_update on public.contracts
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (
      (select public.has_module('leads', true))
      or (select public.has_module('cases', true))
    )
  )
  with check (
    org_id = (select public.auth_org_id())
    and (
      (select public.has_module('leads', true))
      or (select public.has_module('cases', true))
    )
  );
-- DELETE: denied (status='cancelled')

-- ── Policies: contract_terms_acceptances ──────────────────────────────────────
-- SELECT: own acceptance OR staff cases module
create policy contract_terms_acceptances_select on public.contract_terms_acceptances
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_module('cases', false))
  );

-- INSERT: client registers their own in-app disclaimer acceptance
create policy contract_terms_acceptances_insert on public.contract_terms_acceptances
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_case_member(case_id))
  );
-- UPDATE/DELETE: denied (immutable legal evidence)
