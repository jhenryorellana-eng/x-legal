-- ============================================================
-- 0031_drop_staff_scheduling_settings.sql
-- Removes the per-staff scheduling settings table left orphaned by the
-- org-level consolidation (0027_scheduling_org_level).
--
-- Scheduling settings are now org-wide (org_scheduling_settings). No repository
-- reads staff_scheduling_settings any longer and no foreign key references it,
-- so the table is dead weight. Dropping it prevents future confusion about which
-- settings are authoritative.
--
-- Depends on: 0007_scheduling (created it), 0027_scheduling_org_level (superseded it)
-- ============================================================

drop table if exists public.staff_scheduling_settings;
