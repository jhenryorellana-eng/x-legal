-- ============================================================
-- 0032_case_appointment_schedule.sql
-- Per-case appointment route additions (citas intermedias).
--
-- The service cronograma (service_appointment_schedule, 0024 + objectives in
-- 0030) is the SHARED template for every case of a service. case_overrides (0004)
-- only tweaks the per-phase count/duration — it cannot carry an extra cita with
-- its own objectives. This table lets staff add an INTERMEDIATE cita to ONE case
-- (e.g. a follow-up when the previous cita's objectives were not all met), with
-- its own label + objectives. The effective route for a case = service cronograma
-- + these per-case rows, ordered by position then sequence_number.
--
-- The client sees the added cita in their "Mi proceso" cronograma (getCaseTimeline
-- merges these rows). Booking a date/time uses the existing flow; the per-case row
-- raises the case's effective appointment count so the extra cita fits the quota.
--
-- Depends on: 0004_cases (cases, is_case_member), 0024_appointment_schedule,
--             0030_scheduling_objectives_video (objectives_i18n shape)
-- ============================================================

create table public.case_appointment_schedule (
  id               uuid        primary key default gen_random_uuid(),
  case_id          uuid        not null references public.cases(id) on delete cascade,
  service_phase_id uuid        not null references public.service_phases(id) on delete cascade,
  sequence_number  integer     not null check (sequence_number >= 1),
  duration_minutes integer     not null default 30 check (duration_minutes >= 5),
  kind             text        not null default 'video' check (kind in ('video', 'phone', 'presencial')),
  week_offset      integer     not null default 1 check (week_offset >= 1),
  label_i18n       jsonb,
  objectives_i18n  jsonb,      -- [{ "id": "<uuid>", "text": { "es": "...", "en": "..." } }]
  position         integer     not null default 0,
  created_by       uuid        references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (case_id, service_phase_id, sequence_number)
);
comment on table public.case_appointment_schedule is
  'Per-case extra/intermediate citas (with their own objectives) added by staff on top of the service cronograma. Effective route = service_appointment_schedule + these rows.';

drop trigger if exists trg_case_appt_schedule_updated_at on public.case_appointment_schedule;
create trigger trg_case_appt_schedule_updated_at
  before update on public.case_appointment_schedule
  for each row execute function public.set_updated_at();

create index if not exists idx_case_appt_schedule_case_phase
  on public.case_appointment_schedule (case_id, service_phase_id, position);

-- ── RLS (mirrors case_overrides: client reads own case; calendar staff writes) ──
alter table public.case_appointment_schedule enable row level security;

create policy case_appt_schedule_select on public.case_appointment_schedule
  for select to authenticated
  using (
    (select public.is_case_member(case_id))
    or (select public.has_module('calendar', false))
    or (select public.has_module('cases', false))
  );

create policy case_appt_schedule_insert on public.case_appointment_schedule
  for insert to authenticated
  with check (
    (select public.has_module('calendar', true))
    and created_by = (select auth.uid())
  );

create policy case_appt_schedule_update on public.case_appointment_schedule
  for update to authenticated
  using ((select public.has_module('calendar', true)))
  with check ((select public.has_module('calendar', true)));

create policy case_appt_schedule_delete on public.case_appointment_schedule
  for delete to authenticated
  using ((select public.has_module('calendar', true)));
