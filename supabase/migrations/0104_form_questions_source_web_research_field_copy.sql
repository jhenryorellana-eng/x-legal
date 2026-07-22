-- 0104 — 4 fuentes de llenado de campos (ola "web_research + field_copy").
--
-- Añade dos `source` nuevos al enum config-as-data de form_questions:
--   'web_research' = valor producido por una búsqueda de internet interactiva (el
--       staff teclea una consulta → server action con Anthropic web_search + un
--       system prompt configurable en source_ref). No auto-resuelve; el resultado
--       aterriza como answer normal (caja read-only con escape hatch manual).
--       Primer uso: EOIR-26 ítem #12 (dirección del OCC/OPLA a partir de la corte).
--   'field_copy'  = copia el answer PERSISTIDO de otra pregunta (posiblemente de
--       otro formulario del mismo caso). Se materializa en el submit del cuestionario
--       para que la carta lo vea. Primer uso: Constancia de Notificación (dirección
--       del Chief Counsel ← EOIR-26 ítem #12).
--
-- Ver QuestionSourceSchema / SourceRefSchema en catalog/domain.ts y resolveBySource
-- en cases/service.ts.
--
-- Idempotente: drop + recreate del CHECK para que re-correrla sea seguro.

alter table public.form_questions drop constraint if exists form_questions_source_check;

alter table public.form_questions
  add constraint form_questions_source_check
  check (source in (
    'client_answer',
    'document_extraction',
    'generation_output',
    'profile',
    'ai_field',
    'computed',
    'current_date',
    'web_research',
    'field_copy'
  ));
