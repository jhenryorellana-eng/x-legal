-- =============================================================================
-- 0013_audit.sql
-- Block 13: audit_log
-- Depends on: 0001 (orgs, users, set_updated_at)
-- =============================================================================
-- Intent: immutable append-only audit trail of staff mutations.
-- Only admin reads. Only service_role inserts (platform/audit.ts writes with
-- service_role even when the actor is a logged-in staff member). Jobs write
-- with actor_user_id = null and action prefixed 'system.'.

-- ---------------------------------------------------------------------------
-- audit_log (root table ⌂)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id            uuid        primary key default gen_random_uuid(),
  org_id        uuid        not null references public.orgs(id),
  actor_user_id uuid        references public.users(id),
  -- null => system actor (jobs); action must carry 'system.' prefix
  action        text        not null,
  -- e.g. 'catalog.service.updated', 'case.phase_advanced', 'system.cron.run'
  entity_type   text        not null,
  entity_id     uuid,
  diff          jsonb,      -- {before, after} summarized
  ip            inet,
  created_at    timestamptz not null default now(),
  -- audit_log intentionally has NO updated_at: rows are immutable after INSERT.
  -- A trigger enforces this (see below).
  -- Index note: updated_at omitted; set_updated_at trigger NOT attached here.
  check (
    actor_user_id is not null
    or action like 'system.%'
  )
);

-- Indexes: admin queries by org+time and by entity
create index audit_log_org_created_idx
  on public.audit_log (org_id, created_at desc);

create index audit_log_entity_idx
  on public.audit_log (entity_type, entity_id);

-- Immutability trigger: block UPDATE and DELETE on audit_log rows
create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'audit_log rows are immutable (operation: %, table: audit_log)', tg_op
    using errcode = '55000';
end;
$$;

drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.prevent_audit_log_mutation();

alter table public.audit_log enable row level security;

-- SELECT: only admin (has_module('audit', false) — only admin has the 'audit' module per matrix DOC-22 §6)
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('audit', false))
  );

-- INSERT / UPDATE / DELETE: service_role only.
-- No policies for authenticated => denied by default for INSERT/UPDATE/DELETE.
-- UPDATE and DELETE are additionally blocked by the immutability trigger above.
