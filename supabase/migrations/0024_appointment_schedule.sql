-- ============================================================
-- 0024_appointment_schedule.sql
-- Per-appointment schedule within a phase + per-phase processing weeks.
--
-- Extends the catalog so the admin defines, per phase, HOW MANY appointments
-- and the DURATION + WEEK OFFSET of EACH one (the "cronograma"). A phase with
-- no appointments can still contribute trailing "processing" weeks (the
-- "Trámite" phase). The client then sees a week-by-week timeline and an
-- estimated expediente delivery date (anchored on cases.opened_at).
--
-- phase_appointment_policies (0002) is kept as the legacy fallback + source of
-- `kind`: when service_appointment_schedule rows exist for a phase they win
-- (appointment_count = #rows; per-cita duration from the matching sequence_number);
-- otherwise the uniform policy duration is used. No data migration is forced.
--
-- Depends on: 0002_catalog
-- ============================================================

-- ── per-phase trailing processing weeks (the "Trámite") ───────────────────────
alter table public.service_phases
  add column if not exists processing_weeks integer not null default 0
    check (processing_weeks >= 0);
comment on column public.service_phases.processing_weeks is
  'Trailing "trámite" weeks this phase contributes to the client-facing cronograma (e.g. a processing phase with no appointments). Informational only.';

-- ── per-appointment schedule within a phase ───────────────────────────────────
create table public.service_appointment_schedule (
  id               uuid        primary key default gen_random_uuid(),
  service_phase_id uuid        not null references public.service_phases(id) on delete cascade,
  sequence_number  integer     not null check (sequence_number >= 1),
  duration_minutes integer     not null check (duration_minutes >= 5),
  kind             text        not null default 'video' check (kind in ('video', 'phone', 'presencial')),
  week_offset      integer     not null check (week_offset >= 1),
  label_i18n       jsonb,
  position         integer     not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (service_phase_id, sequence_number)
);
comment on table public.service_appointment_schedule is
  'Per-appointment config within a phase: each cita''s own duration + week offset (cronograma). When rows exist they supersede phase_appointment_policies (which stays as legacy fallback + kind default).';

drop trigger if exists trg_service_appointment_schedule_updated_at on public.service_appointment_schedule;
create trigger trg_service_appointment_schedule_updated_at
  before update on public.service_appointment_schedule
  for each row execute function public.set_updated_at();

create index if not exists idx_service_appt_schedule_phase
  on public.service_appointment_schedule (service_phase_id, sequence_number);

-- ── RLS (mirrors phase_appointment_policies / service_phase_milestones) ───────
alter table public.service_appointment_schedule enable row level security;

-- SELECT: catalog editors always; otherwise only for active+public services
-- (client app / sales read the cronograma when rendering a case).
create policy service_appt_schedule_select on public.service_appointment_schedule
  for select to authenticated
  using (
    exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id
         and s.org_id = (select public.auth_org_id())
         and (
           (select public.has_module('catalog', false))
           or (s.is_active and s.archived_at is null)
         )
    )
  );

create policy service_appt_schedule_insert on public.service_appointment_schedule
  for insert to authenticated
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy service_appt_schedule_update on public.service_appointment_schedule
  for update to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  )
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  );

-- DELETE: catalog editor (replaceAppointmentSchedule does delete+insert).
create policy service_appt_schedule_delete on public.service_appointment_schedule
  for delete to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  );
