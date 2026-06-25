-- ============================================================
-- 0034_appointment_client_note.sql
-- Separate the CLIENT's self-booking note from the STAFF's internal log.
--
-- Until now the note a client writes when self-scheduling (agendar-screen,
-- "Nota para tu asesora") was stored in appointments.notes — the SAME column
-- documented (DOC-30 §6, DOC-52 §3.6) as the staff/Vanessa internal log, and
-- which completeAppointment/markNoShow concatenate via mergeNotes(). That mixed
-- two distinct authorships. This adds a dedicated, client-authored column so:
--   - appointments.client_note : the client's note at booking (read-only to staff)
--   - appointments.notes       : staff bitácora (completion/no-show merge target)
--
-- Additive + nullable: existing rows and code keep working before the app writes
-- it. RLS is already enabled on appointments; the new column inherits the
-- table-level policies (all reads go through the service client + service-layer
-- requireCaseAccess/can authorization).
--
-- Depends on: 0007_scheduling.
-- ============================================================

alter table public.appointments
  add column if not exists client_note text;

comment on column public.appointments.client_note is
  'Note the CLIENT writes when self-booking (agendar). Read-only for staff and shown in the cita detail panel. Distinct from appointments.notes (staff internal log).';
