-- ============================================================
-- 0025_prospect_duration.sql
-- Persist the prospect (initial-evaluation) appointment duration that Vanessa
-- configures on "Mi disponibilidad". Until now the "Duración de cita" segment
-- saved nowhere (no column) and reverted on reload. This is the default
-- duration for NON-client (lead/prospect) appointments; CLIENT phase
-- appointments use the per-phase cronograma instead (0024).
-- Additive: default 45 (the previous hardcoded UI default).
-- Depends on: 0007_scheduling (staff_scheduling_settings)
-- ============================================================

alter table public.staff_scheduling_settings
  add column if not exists prospect_duration_minutes integer not null default 45
    check (prospect_duration_minutes >= 5);

comment on column public.staff_scheduling_settings.prospect_duration_minutes is
  'Default duration (minutes) for prospect/initial-evaluation appointments (lead citas). Vanessa configures it on Mi disponibilidad. Client phase appointments use the per-phase schedule instead.';
