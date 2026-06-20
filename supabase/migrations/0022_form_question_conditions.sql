-- 0022_form_question_conditions.sql
-- Feature: generic conditional / dynamic form fields (platform primitive).
--
-- Additive, non-destructive. Adds a `condition` jsonb to form_questions so a
-- question can show / lock / require itself depending on another question's
-- answer (generalizes v1's `dependsOn`). NULL = unconditional (current behavior,
-- backward compatible).
--
-- Shape (validated in code by ConditionSchema, src/shared/form-logic/conditions.ts):
--   {
--     "when":   { "question": "<question_id>", "op": "equals|not_equals|includes|answered|gte|lte", "value": ... },
--     "action": "show" | "lock" | "require",
--     "lock_message_i18n": { "es": "...", "en": "..." }   -- optional, for action=lock
--   }
--
-- Overflow (e.g. the 5th child on I-589) is expressed as a normal question whose
-- condition is { when:{question:<#children>, op:'gte', value:5}, action:'show' }
-- mapped to the form's own continuation slots — no separate repeater/supplement.
--
-- Rollback: ALTER TABLE public.form_questions DROP COLUMN condition;

ALTER TABLE public.form_questions
  ADD COLUMN IF NOT EXISTS condition jsonb;

-- Note: `when.question` holds a question UUID and IS exposed to the client via
-- getFormForClient (the wizard needs it to evaluate conditions in-browser). Question
-- UUIDs are not sensitive — this exposure is by design.
COMMENT ON COLUMN public.form_questions.condition IS
  'Optional {when:{question,op,value}, action:show|lock|require, lock_message_i18n?}. NULL = unconditional. See src/shared/form-logic/conditions.ts.';
