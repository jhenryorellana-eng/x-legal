-- 0098 — Ola apelación (EOIR-26A): add the 'computed' question source.
--
-- A `computed` question is a DERIVED total: an exact arithmetic function (sum /
-- subtract) of other questions' answers, resolved deterministically at PDF-fill
-- time — never client-typed, never sent to AI. First use: the EOIR-26A Fee Waiver
-- Request totals (Part 1 · 1.A, Part 2 · 2.B, Part 3 · TOTAL = income − expenses,
-- which may be negative). See src/shared/form-logic/computed.ts and the
-- QuestionSourceSchema / SourceRefSchema in catalog/domain.ts. The config lives in
-- form_questions.source_ref as { op: 'sum'|'subtract', inputs: [questionId, …] }.
--
-- Idempotent: drop + recreate the CHECK so re-running is safe.

alter table public.form_questions drop constraint if exists form_questions_source_check;

alter table public.form_questions
  add constraint form_questions_source_check
  check (source in (
    'client_answer',
    'document_extraction',
    'generation_output',
    'profile',
    'ai_field',
    'computed'
  ));
