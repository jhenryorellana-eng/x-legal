-- 0086: per-question "Mejorar con IA" config.
-- null = disabled; {"instruction": string} = the improve button is offered to the
-- client for this question and the instruction steers the rewrite (format rules).
-- Editable also on PUBLISHED versions via the dedicated use case
-- catalog.updateQuestionAiImprove (controlled exception to version immutability,
-- precedent: form_fill_guides). The instruction NEVER travels to the client —
-- the client DTO only exposes a boolean.

alter table public.form_questions
  add column if not exists ai_improve jsonb;

comment on column public.form_questions.ai_improve is
  'Config "Mejorar con IA" por campo: null = desactivado; {"instruction": string} = activo. Editable tambien en versiones published (excepcion controlada, precedente form_fill_guides). La instruccion nunca se envia al cliente.';
