-- 0053_ai_field_and_questionnaire.sql
-- Etapa B: sistema admin-configurable de campos rellenados por IA.
-- Todo aditivo / no destructivo (sin datos reales en producción todavía).
--
-- 1) Nuevo kind de formulario: 'questionnaire' (cuestionario complementario sin
--    PDF, que nutre la redacción de un ai_letter). Reusa toda la infra de
--    preguntas (form_question_groups / form_questions); su versión no tiene PDF.
-- 2) ai_generation_runs.output_structured jsonb — corrige el source
--    'generation_output' para navegación determinista (la columna 'output' nunca
--    existió; el código la leía y devolvía null). El nuevo source 'ai_field'↔carta
--    NO la necesita (interpreta output_text con IA), pero la dejamos para el
--    camino determinista legacy.
-- 3) form_definitions.companion_questionnaire_id — enlaza un ai_letter con su
--    cuestionario complementario auto-creado.
-- 4) form_automation_versions.source_pdf_path nullable — un 'questionnaire' tiene
--    versión (para colgar grupos/preguntas) pero sin PDF.

-- (1) kind 'questionnaire' — la columna es text + CHECK (DOC-30 §0: text+CHECK, no ENUM)
alter table public.form_definitions
  drop constraint if exists form_definitions_kind_check;
alter table public.form_definitions
  add constraint form_definitions_kind_check
  check (kind in ('ai_letter', 'pdf_automation', 'questionnaire'));

comment on table public.form_definitions is
  'Unified form system (replaces 4 legacy systems D3). Supports ai_letter, pdf_automation and questionnaire kinds.';

-- (2) salida estructurada de la generación (navegable por generation_output)
alter table public.ai_generation_runs
  add column if not exists output_structured jsonb;

comment on column public.ai_generation_runs.output_structured is
  'Optional structured (JSON) output of a generation run, navigable by output_path '
  'for the generation_output question source. NULL for plain markdown/pdf runs.';

-- (3) enlace ai_letter -> cuestionario complementario
alter table public.form_definitions
  add column if not exists companion_questionnaire_id uuid
  references public.form_definitions(id) on delete set null;

comment on column public.form_definitions.companion_questionnaire_id is
  'For an ai_letter: the auto-created questionnaire (kind=questionnaire) whose '
  'answers feed this generation. NULL otherwise.';

-- (4) un questionnaire tiene versión sin PDF
alter table public.form_automation_versions
  alter column source_pdf_path drop not null;
