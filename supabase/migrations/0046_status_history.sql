-- =============================================================================
-- 0046_status_history.sql
-- Immutable per-status transition logs for cases and leads, populated by DB
-- triggers (can't be bypassed by any write path). Enables time-in-status and
-- cycle-time KPIs going forward. No backfill (no real production data yet).
-- Mirrors the case_stage_history / case_phase_history immutable-log pattern.
-- Depends on: 0004 (cases), 0003 (leads), prevent_row_mutation() (0001/0004).
-- =============================================================================

-- 1 ── case_status_history ──────────────────────────────────────────────────────
create table if not exists public.case_status_history (
  id          uuid        primary key default gen_random_uuid(),
  case_id     uuid        not null references public.cases(id) on delete cascade,
  from_status text,
  to_status   text        not null,
  changed_by  uuid        references public.users(id),
  note        text,
  created_at  timestamptz not null default now()
);
comment on table public.case_status_history is
  'Log inmutable de transiciones de cases.status. Poblada por trigger. Habilita KPIs de tiempo-en-estado.';

create index if not exists case_status_history_case_idx
  on public.case_status_history (case_id, created_at);

alter table public.case_status_history enable row level security;

create policy case_status_history_select on public.case_status_history
  for select to authenticated
  using ( (select public.has_module('cases', false)) );

drop trigger if exists case_status_history_immutable on public.case_status_history;
create trigger case_status_history_immutable
  before update or delete on public.case_status_history
  for each row execute function public.prevent_row_mutation();

-- 2 ── lead_status_history ──────────────────────────────────────────────────────
create table if not exists public.lead_status_history (
  id          uuid        primary key default gen_random_uuid(),
  lead_id     uuid        not null references public.leads(id) on delete cascade,
  from_status text,
  to_status   text        not null,
  changed_by  uuid        references public.users(id),
  note        text,
  created_at  timestamptz not null default now()
);
comment on table public.lead_status_history is
  'Log inmutable de transiciones de leads.status. Poblada por trigger. Habilita cycle-time de ventas.';

create index if not exists lead_status_history_lead_idx
  on public.lead_status_history (lead_id, created_at);

alter table public.lead_status_history enable row level security;

create policy lead_status_history_select on public.lead_status_history
  for select to authenticated
  using ( (select public.has_module('leads', false)) );

drop trigger if exists lead_status_history_immutable on public.lead_status_history;
create trigger lead_status_history_immutable
  before update or delete on public.lead_status_history
  for each row execute function public.prevent_row_mutation();

-- 3 ── Trigger functions (SECURITY DEFINER → insert bypasses RLS) ────────────────
create or replace function public.log_case_status_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.case_status_history(case_id, from_status, to_status, changed_by)
  values (new.id, old.status, new.status, auth.uid());
  return new;
end;
$$;

create or replace function public.log_lead_status_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.lead_status_history(lead_id, from_status, to_status, changed_by)
  values (new.id, old.status, new.status, auth.uid());
  return new;
end;
$$;

-- 4 ── Wire triggers (only fire on an actual status change) ──────────────────────
drop trigger if exists cases_status_change_log on public.cases;
create trigger cases_status_change_log
  after update of status on public.cases
  for each row when (old.status is distinct from new.status)
  execute function public.log_case_status_change();

drop trigger if exists leads_status_change_log on public.leads;
create trigger leads_status_change_log
  after update of status on public.leads
  for each row when (old.status is distinct from new.status)
  execute function public.log_lead_status_change();

-- 5 ── Harden: these are trigger-only functions; they must NOT be exposed as REST
-- RPCs. Triggers still execute them (as table owner) after the grant is revoked.
revoke all on function public.log_case_status_change() from public, anon, authenticated;
revoke all on function public.log_lead_status_change() from public, anon, authenticated;
