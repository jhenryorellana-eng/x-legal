-- 0033: Milestone-level progression — hitos as the first-class progress unit.
--
-- Co-design (DOC-51 §22): the case advances milestone-by-milestone (not only by phase).
-- The client "Mi proceso" timeline interleaves legal milestones + scheduled citas by week.
--
--  1. service_phase_milestones.week_offset — approximate week of the milestone (for ordering
--     against citas and the "Semana N" label). Nullable (milestones with no week sort by phase/position).
--  2. cases.current_milestone_id — finer-grained pointer than current_phase_id (kept in sync).
--  3. case_milestone_history — immutable log of milestone transitions (mirrors case_phase_history);
--     entered_at is the "approximate reached date".

-- 1 ──────────────────────────────────────────────────────────────────────────
alter table public.service_phase_milestones
  add column if not exists week_offset integer
    check (week_offset is null or week_offset >= 1);

-- 2 ──────────────────────────────────────────────────────────────────────────
alter table public.cases
  add column if not exists current_milestone_id uuid
    references public.service_phase_milestones(id) on delete set null;

-- 3 ──────────────────────────────────────────────────────────────────────────
create table if not exists public.case_milestone_history (
  id           uuid        primary key default gen_random_uuid(),
  case_id      uuid        not null references public.cases(id) on delete cascade,
  milestone_id uuid        not null references public.service_phase_milestones(id),
  entered_at   timestamptz not null default now(),
  entered_by   uuid        references public.users(id),
  note         text,
  created_at   timestamptz not null default now()
  -- No updated_at: history is immutable (trigger prevents UPDATE/DELETE)
);
comment on table public.case_milestone_history is
  'Immutable log of milestone transitions ("Mi proceso"). Trigger enforces no UPDATE/DELETE.';

create index if not exists case_milestone_history_case_idx
  on public.case_milestone_history (case_id, entered_at);

alter table public.case_milestone_history enable row level security;

-- Client sees their own case milestone history; staff with the cases module sees all.
create policy case_milestone_history_select on public.case_milestone_history
  for select to authenticated
  using (
    (select public.is_case_member(case_id))
    or (select public.has_module('cases', false))
  );

create policy case_milestone_history_insert on public.case_milestone_history
  for insert to authenticated
  with check (
    (select public.has_module('cases', true))
    and entered_by = (select auth.uid())
  );

drop trigger if exists case_milestone_history_immutable on public.case_milestone_history;
create trigger case_milestone_history_immutable
  before update or delete on public.case_milestone_history
  for each row execute function public.prevent_row_mutation();
