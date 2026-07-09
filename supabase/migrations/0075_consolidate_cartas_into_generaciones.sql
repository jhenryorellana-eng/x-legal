-- 0075_consolidate_cartas_into_generaciones
--
-- The case-workspace "letters" tab used to have TWO ids that render the same
-- component: `cartas` (paralegal/sales label "Cartas") and `generaciones` (admin
-- label "Generaciones"). The SoT (RF-TRX-025, DOC-54 §3) defines a SINGLE canonical
-- tab: Generaciones ("Cartas"). The code now drops `cartas`, so its per-role
-- visibility override rows in case_tab_role_access must be merged into
-- `generaciones` (otherwise a role that had `cartas` enabled but `generaciones`
-- disabled — e.g. paralegal — would lose the tab entirely).
--
-- Data-only, no schema change (visibility-config table). The merge is one-way:
-- step 1's in-place UPDATE and step 3's hard DELETE drop the pre-merge `cartas`
-- state, so there is no rollback script — restore from backup/audit if ever needed.

-- 1) Enable `generaciones` for any (org,role) that had `cartas` enabled (merge).
update public.case_tab_role_access g
set enabled = true, updated_at = now()
from public.case_tab_role_access c
where c.org_id = g.org_id and c.role = g.role
  and g.tab_id = 'generaciones' and c.tab_id = 'cartas' and c.enabled = true;

-- 2) For (org,role) that had a `cartas` row but NO `generaciones` row, create
--    `generaciones` mirroring `cartas`.
insert into public.case_tab_role_access (org_id, role, tab_id, enabled, updated_by)
select c.org_id, c.role, 'generaciones', c.enabled, c.updated_by
from public.case_tab_role_access c
where c.tab_id = 'cartas'
  and not exists (
    select 1 from public.case_tab_role_access g
    where g.org_id = c.org_id and g.role = c.role and g.tab_id = 'generaciones'
  );

-- 3) Remove the now-defunct `cartas` rows.
delete from public.case_tab_role_access where tab_id = 'cartas';
