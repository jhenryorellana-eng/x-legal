-- 0090 — AI draft answers for per-case questionnaires (autofill total).
--
-- The generation job writes one AI-drafted answer per question (base + generated)
-- into the INSTANCE — never straight into case_form_responses.answers, which
-- remains the client's attested record. The wizard surfaces drafts as prefills
-- ("Borrador IA — revísalo"); on submit, untouched drafts are materialized into
-- answers WITH provenance (ai_draft_question_ids) so staff can always tell an
-- AI-drafted answer from client testimony.

alter table public.case_questionnaire_instances
  add column if not exists draft_answers jsonb;

comment on column public.case_questionnaire_instances.draft_answers is
  'AI-drafted answer per question id ({"<questionId>":"<text>"}), grounded in the case record. Dies with the instance (a regeneration mints new drafts).';

alter table public.questionnaire_generation_configs
  add column if not exists draft_answers_enabled boolean not null default false,
  add column if not exists draft_answers_prompt text;

comment on column public.questionnaire_generation_configs.draft_answers_enabled is
  'Config-as-data toggle: generate AI draft answers for every client question after the questionnaire is materialized.';
comment on column public.questionnaire_generation_configs.draft_answers_prompt is
  'Optional extra instructions appended to the draft-answers system prompt.';

alter table public.case_form_responses
  add column if not exists ai_draft_question_ids jsonb;

comment on column public.case_form_responses.ai_draft_question_ids is
  'Provenance: question ids whose submitted answer was materialized from the instance AI draft (client reviewed but did not edit).';
