-- 0059_case_tab_role_access.sql
-- Admin-configurable, per-role visibility of the case workspace tabs.
--
-- The code (src/shared/constants/case-tabs.ts) holds the per-role DEFAULT tab
-- set + order + gating. This table stores OPTIONAL org-level OVERRIDES of which
-- tabs a role sees. Semantics: if an (org, role) has ANY row here → that role's
-- visible set = the enabled tab_ids (order still from code); if it has NO rows →
-- the code default applies. Empty table ⇒ current behaviour (fully backward
-- compatible, no seed). Only visibility is configurable — order and the
-- "locked until the case is active" gating stay in code.

create table public.case_tab_role_access (
  id         uuid        primary key default gen_random_uuid(),
  org_id     uuid        not null references public.orgs(id) on delete cascade,
  role       text        not null check (role in ('admin', 'sales', 'paralegal', 'finance')),
  tab_id     text        not null,
  enabled    boolean     not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid        references public.users(id),
  unique (org_id, role, tab_id)
);

comment on table public.case_tab_role_access is
  'Org-level override of which case-workspace tabs a staff role can see. No rows for an (org,role) ⇒ code default. Order + state-gating stay in code.';

create index case_tab_role_access_org_role_idx
  on public.case_tab_role_access (org_id, role);

create trigger case_tab_role_access_set_updated_at
  before update on public.case_tab_role_access
  for each row execute function public.set_updated_at();

alter table public.case_tab_role_access enable row level security;

-- Read: any staff of the org (the case pages resolve the override on load).
create policy case_tab_role_access_select on public.case_tab_role_access
  for select to authenticated
  using (
    (select public.is_staff())
    and org_id = (select public.auth_org_id())
  );

-- Write: admin of the org only (defense in depth; the service also gates admin).
create policy case_tab_role_access_insert on public.case_tab_role_access
  for insert to authenticated
  with check (
    (select public.staff_role()) = 'admin'
    and org_id = (select public.auth_org_id())
  );

create policy case_tab_role_access_update on public.case_tab_role_access
  for update to authenticated
  using (
    (select public.staff_role()) = 'admin'
    and org_id = (select public.auth_org_id())
  )
  with check (
    (select public.staff_role()) = 'admin'
    and org_id = (select public.auth_org_id())
  );

create policy case_tab_role_access_delete on public.case_tab_role_access
  for delete to authenticated
  using (
    (select public.staff_role()) = 'admin'
    and org_id = (select public.auth_org_id())
  );
