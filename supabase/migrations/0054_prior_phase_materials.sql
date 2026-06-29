-- 0054_prior_phase_materials.sql
-- Etapa C: vista staff (lectura) de documentos/forms de fases anteriores.
-- Etiqueta cada documento + respuesta de formulario con la fase del servicio a la
-- que pertenece, para que los materiales de fases ya completadas sigan visibles
-- (solo lectura) en el workspace legal. Aditivo (columna nullable + backfill).

alter table public.case_documents
  add column if not exists service_phase_id uuid references public.service_phases(id);
alter table public.case_form_responses
  add column if not exists service_phase_id uuid references public.service_phases(id);

-- Backfill: asigna la fase que estaba activa cuando se creó la fila (según
-- case_phase_history), con fallback a la fase actual del caso.
update public.case_documents cd
set service_phase_id = coalesce(
  (select ph.phase_id from public.case_phase_history ph
   where ph.case_id = cd.case_id and ph.entered_at <= cd.created_at
   order by ph.entered_at desc limit 1),
  (select c.current_phase_id from public.cases c where c.id = cd.case_id)
)
where cd.service_phase_id is null;

update public.case_form_responses cr
set service_phase_id = coalesce(
  (select ph.phase_id from public.case_phase_history ph
   where ph.case_id = cr.case_id and ph.entered_at <= cr.created_at
   order by ph.entered_at desc limit 1),
  (select c.current_phase_id from public.cases c where c.id = cr.case_id)
)
where cr.service_phase_id is null;

create index if not exists idx_case_documents_service_phase on public.case_documents(case_id, service_phase_id);
create index if not exists idx_case_form_responses_service_phase on public.case_form_responses(case_id, service_phase_id);

comment on column public.case_documents.service_phase_id is
  'Service phase active when this document was uploaded (Etapa C — prior-phase visibility).';
comment on column public.case_form_responses.service_phase_id is
  'Service phase active when this form response was created (Etapa C).';
