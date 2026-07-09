-- 0077_premortem_validation_reshape.sql
-- Reorientación del Pre-Mortem: de "predictor de motivos de denegación de asilo"
-- a "validador de calidad" de una generación/automatización concreta (ai_letter
-- o pdf_automation, p.ej. USCIS I-589). Tres cambios:
--   A) Reshape in-place de case_pre_mortem_assessments (target polimórfico + score
--      + semáforo + veredicto + findings). La tabla está prácticamente vacía
--      (0-1 filas placeholder) → truncate seguro; se preservan nombre, carácter
--      append-only, índice (case_id, created_at desc), columnas de coste (roll-up
--      RF-DIA-021) y las policies RLS org-scope de 0056 (siguen válidas: case_id
--      permanece; la nueva response_id se gobierna por la misma fila/case_id).
--   B) Nueva tabla form_fill_guides: rúbrica (guía de llenado) por form_definition
--      + flag unificado que activa el Pre-Mortem para AMBOS kinds.
--   C) Backfill del flag antiguo (ai_generation_configs.pre_mortem_enabled), que
--      queda deprecado e inerte (el gating deja de leerlo). Se elimina en una
--      migración posterior, tras migrar la UI del editor.

-- ── A) Reshape case_pre_mortem_assessments ───────────────────────────────────
-- Placeholder rows only → truncado seguro antes de re-tipar el shape.
truncate table public.case_pre_mortem_assessments;

alter table public.case_pre_mortem_assessments
  -- Target polimórfico: dos FKs reales (integridad + ON DELETE por tabla) en vez
  -- de un target_id genérico sin FK. run_id ya existe (ai_letter); response_id es
  -- el nuevo destino para automatizaciones (pdf_automation).
  add column target_kind text not null default 'ai_letter'
    check (target_kind in ('ai_letter', 'pdf_automation')),
  add column response_id  uuid references public.case_form_responses(id) on delete set null,
  add column score        integer check (score between 0 and 100),
  add column semaforo      text    check (semaforo in ('green', 'amber', 'red')),
  add column verdict       text    check (verdict in ('would_approve', 'needs_corrections', 'would_reject'));

-- reasons(jsonb) → findings(jsonb): mismo tipo, nueva semántica.
-- findings = [{ severity, category, location, description, correction }].
alter table public.case_pre_mortem_assessments rename column reasons to findings;

-- overall_risk queda obsoleto (semaforo lo reemplaza).
alter table public.case_pre_mortem_assessments drop column overall_risk;

-- Exactamente un destino, coherente con target_kind.
alter table public.case_pre_mortem_assessments
  add constraint premortem_target_shape check (
    (target_kind = 'ai_letter'      and run_id      is not null and response_id is null) or
    (target_kind = 'pdf_automation' and response_id is not null and run_id      is null)
  );

-- El default sólo servía para poblar filas existentes (no hay tras el truncate).
alter table public.case_pre_mortem_assessments alter column target_kind drop default;

comment on table public.case_pre_mortem_assessments is
  'Pre-Mortem quality validations per case: score 0-100 + semáforo + verdict + findings[] for a generated artifact (ai_letter run OR pdf_automation response). Append-only history; cost rolls up into the case AI spend (RF-DIA-021).';
comment on column public.case_pre_mortem_assessments.findings is
  '[{ severity: critico|moderado|sugerencia, category, location, description, correction }] — validated against src/shared/constants/finding-categories.ts.';

-- ── B) form_fill_guides: rúbrica + flag por form_definition ───────────────────
create table if not exists public.form_fill_guides (
  form_definition_id uuid    primary key references public.form_definitions(id) on delete cascade,
  guide_markdown     text    not null default '',   -- rúbrica canónica, inyectada COMPLETA
  source_file_path   text,                            -- .md subido (procedencia; catalog-assets)
  enabled            boolean not null default false,  -- flag unificado de Pre-Mortem (ambos kinds)
  updated_by         uuid    references public.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.form_fill_guides is
  'Rúbrica de validación (guía de llenado) por form_definition, para ai_letter y pdf_automation. enabled = flag que activa el tab Pre-Mortem del caso. Reemplaza a ai_generation_configs.pre_mortem_enabled (deprecado).';

drop trigger if exists trg_form_fill_guides_updated_at on public.form_fill_guides;
create trigger trg_form_fill_guides_updated_at
  before update on public.form_fill_guides
  for each row execute function public.set_updated_at();

alter table public.form_fill_guides enable row level security;

-- Mirror EXACTO de ai_generation_configs (tabla hermana de config admin, misma
-- sensibilidad): gate por has_module('catalog', …). Los jobs/acciones server-side
-- usan service_role y omiten RLS. NOTA (decisión Henry): si el deployment pasa a
-- multi-org, endurecer con join form_definitions→service_phases→services.org_id =
-- auth_org_id() (mismo criterio MED-1 que 0056 aplicó al Pre-Mortem).
create policy form_fill_guides_select on public.form_fill_guides
  for select to authenticated
  using ( (select public.has_module('catalog', false)) );

create policy form_fill_guides_insert on public.form_fill_guides
  for insert to authenticated
  with check ( (select public.has_module('catalog', true)) );

create policy form_fill_guides_update on public.form_fill_guides
  for update to authenticated
  using      ( (select public.has_module('catalog', true)) )
  with check ( (select public.has_module('catalog', true)) );

-- ── C) Backfill del flag antiguo → form_fill_guides.enabled ───────────────────
insert into public.form_fill_guides (form_definition_id, enabled)
select form_definition_id, true
from public.ai_generation_configs
where pre_mortem_enabled = true
on conflict (form_definition_id) do update set enabled = true;

comment on column public.ai_generation_configs.pre_mortem_enabled is
  'DEPRECADO (0077): el gating del Pre-Mortem ahora lee form_fill_guides.enabled. Backfilled a form_fill_guides; se elimina en una migración posterior tras migrar la UI del editor.';
