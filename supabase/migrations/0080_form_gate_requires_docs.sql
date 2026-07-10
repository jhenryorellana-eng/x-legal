-- 0080_form_gate_requires_docs.sql
-- Ola 2 — Gate global "documentos 100% → formularios".
--
-- A client cannot open/fill a form until every VISIBLE required document of the
-- case is uploaded (computed by buildDocumentsMatrix; staff hide non-applicable
-- optional docs via case_requirement_overrides.is_hidden). The gate is enforced
-- in cases.getFormForClient (the single choke point for the wizard, the direct
-- URL, and Mi Historia).
--
-- Global by default (column default true); admin can exempt an individual form
-- (e.g. an intake survey that must precede document upload) by setting it false.
-- Additive, non-destructive.

alter table public.form_definitions
  add column if not exists requires_documents_complete boolean not null default true;

comment on column public.form_definitions.requires_documents_complete is
  'When true (default), a client cannot open/fill this form until 100% of the case''s visible documents are uploaded (Ola 2 gate, enforced in cases.getFormForClient). Set false to exempt intake-style forms that must precede document upload.';
