-- 0038: case_documents.translation_not_required — staff marks a document as
-- already in English (no ES→EN translation needed). Excludes it from the
-- "Documentos traducidos" gating task of the sales handoff.

alter table public.case_documents
  add column if not exists translation_not_required boolean not null default false;
comment on column public.case_documents.translation_not_required is
  'Staff flag: document is already in English → not counted in the translation gating.';
