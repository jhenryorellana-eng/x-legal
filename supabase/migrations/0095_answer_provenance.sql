-- 0095 — Answer provenance as a first-class dimension + audited low-coverage override.
--
-- WHY. 0090 introduced `draft_answers` as a flat jsonb of strings and recorded
-- provenance as a single flat array (`ai_draft_question_ids`). That array answers
-- "was this AI-drafted?" but NOT the question that matters: "was this drafted from
-- evidence, or fabricated to fill a hole?". Without that distinction the completeness
-- gate counted a fabricated filler as an answer, and case U26-000038 reached
-- `approved` with 15 of 25 answers reading "Por ahora no cuento con información" —
-- in the client's own first-person voice — which then flowed into the appeal brief
-- as if it were her testimony.
--
-- Provenance is a state machine (see src/shared/constants/answer-provenance.ts):
-- human input wins and is terminal, so a regeneration can never demote a
-- client-authored answer back to an AI one.
--
-- BACKFILL POLICY: existing rows are marked 'unknown', never guessed. Inferring
-- provenance for already-approved cases would make dashboards look tidy while
-- lying about which briefs rest on real testimony. An admin action reclassifies
-- open cases on demand.

alter table public.case_questionnaire_instances
  add column if not exists draft_provenance jsonb;

comment on column public.case_questionnaire_instances.draft_provenance is
  'Authoritative provenance per question id ({"<questionId>":"<AnswerProvenance>"}), written ONLY by the generation job. Keys must mirror draft_answers exactly.';

alter table public.case_form_responses
  add column if not exists answer_provenance jsonb;

comment on column public.case_form_responses.answer_provenance is
  'Provenance per question id, COPIED from the instance at submit and updated on client edits. Supersedes ai_draft_question_ids (kept for back-compat).';

-- Audited override: a case may legitimately contain questions nobody can answer
-- (e.g. the hearing transcript was never issued). Staff must be able to proceed —
-- but by signing for it, never by the system silently fabricating an answer.
alter table public.case_form_responses
  add column if not exists low_coverage_ack jsonb;

comment on column public.case_form_responses.low_coverage_ack is
  'Audited staff override of the coverage warning: {"by":"<userId>","at":"<iso>","reason":"<text>","coverage_pct":<int>}. Null = never overridden. Required-field gaps are NOT overridable.';

-- Backfill: every pre-existing instance/response gets an explicit 'unknown' map so
-- coverage math has a real denominator instead of silently treating history as 100%.
update public.case_questionnaire_instances i
set draft_provenance = (
  select jsonb_object_agg(k, 'unknown')
  from jsonb_object_keys(i.draft_answers) as k
)
where i.draft_answers is not null
  and jsonb_typeof(i.draft_answers) = 'object'
  and i.draft_provenance is null
  and exists (select 1 from jsonb_object_keys(i.draft_answers));

update public.case_form_responses r
set answer_provenance = (
  select jsonb_object_agg(k, 'unknown')
  from jsonb_object_keys(r.answers) as k
)
where r.answers is not null
  and jsonb_typeof(r.answers) = 'object'
  and r.answer_provenance is null
  and exists (select 1 from jsonb_object_keys(r.answers));
