-- 0101 — Ola apelación (Statement of Reasons / Proof of Service): add the
-- 'current_date' question source.
--
-- A `current_date` question resolves to TODAY's date in the org timezone at
-- PDF-generation time — never client-typed, never sent to AI. For a date field it
-- flows through the same formatPdfDate() the extracted dates use (→ MM/DD/YYYY),
-- so no per-field formatting config is needed. First use: EOIR-26 item #9 (signature
-- date) and item #12(B) (Proof of Service mailing date). See resolveBySource in
-- cases/service.ts and the QuestionSourceSchema / SourceRefSchema in
-- catalog/domain.ts (source_ref is always null for this source).
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
    'computed',
    'current_date'
  ));
