-- 0065_form_fill_policy_and_multiselect.sql
-- Feature: two platform primitives for correct AcroForm filling (I-589 hardening).
--
-- Additive, non-destructive, backward compatible.
--
-- 1) form_question_groups.do_not_fill — a section that must stay BLANK in the
--    generated PDF by legal design (e.g. I-589 Part D signature line, Part F
--    "To Be Completed at the Asylum Interview", Part G "…at the Removal Hearing").
--    The generator skips filling AND skips the "N/A" backfill for every question
--    in a do_not_fill group. NULL/false = normal (current behavior).
--
-- 2) form_questions.field_type gains 'multiselect' — a question that maps to a
--    GROUP of checkboxes where MORE THAN ONE may be ticked at once (e.g. I-589
--    Part B.1 asylum bases: race/religion/nationality/political opinion/particular
--    social group/torture). Each option carries its own pdf_field_name (same shape
--    as 'select'); the generator ticks every chosen box. Minimum-selected is
--    enforced via validation.minSelected (jsonb, no schema change).
--
-- Rollback:
--   ALTER TABLE public.form_question_groups DROP COLUMN do_not_fill;
--   ALTER TABLE public.form_questions DROP CONSTRAINT form_questions_field_type_check;
--   ALTER TABLE public.form_questions ADD CONSTRAINT form_questions_field_type_check
--     CHECK (field_type in ('text','number','date','checkbox','select','textarea'));

-- 1) do_not_fill on groups -----------------------------------------------------
ALTER TABLE public.form_question_groups
  ADD COLUMN IF NOT EXISTS do_not_fill boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.form_question_groups.do_not_fill IS
  'When true, the generator leaves every field in this group BLANK by design '
  '(no value, no N/A backfill) — e.g. I-589 Part D signature, Parts F/G. Default false.';

-- 2) allow field_type = 'multiselect' -----------------------------------------
ALTER TABLE public.form_questions
  DROP CONSTRAINT IF EXISTS form_questions_field_type_check;

ALTER TABLE public.form_questions
  ADD CONSTRAINT form_questions_field_type_check
  CHECK (field_type IN ('text', 'number', 'date', 'checkbox', 'select', 'textarea', 'multiselect'));

COMMENT ON COLUMN public.form_questions.field_type IS
  'text|number|date|checkbox|select|textarea|multiselect. multiselect maps to a '
  'checkbox GROUP (options[].pdf_field_name); several boxes may be ticked. '
  'validation.minSelected enforces a minimum (e.g. I-589 Part B.1 asylum bases).';
