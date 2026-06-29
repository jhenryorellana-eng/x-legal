-- 0056_premortem_rls_org_scope.sql
-- Etapa D — endurecimiento de seguridad (auditoría MED-1).
-- Org-scope la RLS de case_pre_mortem_assessments: la tabla no tiene org_id y las
-- policies de 0055 sólo comprobaban has_module('cases',…), que NO compara el org de
-- la fila. Vía PostgREST directo (anon key es pública), un staff de org A podría
-- SELECT/INSERT filas de org B (PII derivada en summary/reasons). Se cierra haciendo
-- join a public.cases y exigiendo c.org_id = auth_org_id() (mismo patrón que
-- ai_dataset_items_select en 0002). Aditivo: sólo reemplaza las 2 policies.

drop policy if exists case_pre_mortem_select on public.case_pre_mortem_assessments;
create policy case_pre_mortem_select on public.case_pre_mortem_assessments
  for select to authenticated
  using (
    (select public.has_module('cases', false))
    and exists (
      select 1 from public.cases c
      where c.id = case_id and c.org_id = (select public.auth_org_id())
    )
  );

drop policy if exists case_pre_mortem_insert on public.case_pre_mortem_assessments;
create policy case_pre_mortem_insert on public.case_pre_mortem_assessments
  for insert to authenticated
  with check (
    (select public.has_module('cases', true))
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.cases c
      where c.id = case_id and c.org_id = (select public.auth_org_id())
    )
  );
