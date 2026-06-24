-- ============================================================
-- 0030_scheduling_objectives_video.sql
-- Org-shared video link + reminders toggle, per-appointment video link,
-- per-cita objectives (admin template) and per-appointment objectives outcome.
--
-- Closes the gaps reported on /ventas/disponibilidad and /ventas/citas:
--   1. The "Enlace de videollamada" entered in Mi disponibilidad had nowhere to
--      persist → add org_scheduling_settings.video_link (org-shared default) and
--      appointments.video_link (the effective link the client sees; snapshot of
--      the org default at booking, overridable per appointment).
--   2. The "Recordatorios automáticos" toggle had nowhere to persist → add
--      org_scheduling_settings.reminders_enabled (org-shared default for new
--      appointments' reminder_1d/1h flags).
--   3. Appointment OBJECTIVES: the admin defines them per cita when building the
--      service cronograma → service_appointment_schedule.objectives_i18n (i18n
--      template). When a cita is completed the advisor records which objectives
--      were achieved → appointments.objectives_outcome (snapshot, staff detail).
--
-- All columns are additive + nullable (or defaulted) so existing rows and code
-- keep working before the app starts writing them. RLS is already enabled on
-- every table touched; new columns inherit the table-level policies.
--
-- Depends on: 0007_scheduling, 0024_appointment_schedule, 0027_scheduling_org_level
-- ============================================================

-- ── Org-shared "Reglas / Recordatorios" ──────────────────────────────────────
alter table public.org_scheduling_settings
  add column if not exists video_link        text,
  add column if not exists reminders_enabled boolean not null default true;

comment on column public.org_scheduling_settings.video_link is
  'Org-wide default video-call link (e.g. a shared meeting room). Copied into appointments.video_link at booking when kind=video and no per-cita override is given.';
comment on column public.org_scheduling_settings.reminders_enabled is
  'Org-wide default for whether new appointments enable automatic client reminders (1d/1h).';

-- ── Per-appointment effective video link (what the client opens) ──────────────
alter table public.appointments
  add column if not exists video_link text;

comment on column public.appointments.video_link is
  'Effective video-call link for this appointment (snapshot of the org default at booking, or a per-cita override). The client''s "Entrar a la videollamada" opens this until LiveKit (F7) exists.';

-- ── Per-cita objectives the admin defines in the service cronograma ───────────
--   objectives_i18n :: jsonb = [{ "id": "<uuid>", "text": { "es": "...", "en": "..." } }]
alter table public.service_appointment_schedule
  add column if not exists objectives_i18n jsonb;

comment on column public.service_appointment_schedule.objectives_i18n is
  'Ordered objectives for this cita (admin-defined template): array of { id, text: { es, en } }. Resolved into the appointment detail by (service_phase_id, sequence_number).';

-- ── Per-appointment objectives outcome recorded at completion ─────────────────
--   objectives_outcome :: jsonb = [{ "id": "<uuid>", "text": "...", "achieved": true }]
alter table public.appointments
  add column if not exists objectives_outcome jsonb;

comment on column public.appointments.objectives_outcome is
  'Snapshot of which objectives were achieved when the advisor completed the cita: array of { id, text, achieved }. Staff-internal detail; the client only sees a high-level "X de Y" summary in the case timeline.';
