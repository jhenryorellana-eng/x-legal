-- =============================================================================
-- 0029_required_document_types_accepted_format.sql
-- Per-document accepted file format (admin-configurable): PDF or PNG only.
--
-- Until now the accepted MIME for client case documents was a single global
-- policy (PDF only, RF-TRX-033). The admin now chooses, per required document,
-- whether the client uploads a PDF or a PNG. The client upload `accept` and the
-- server-side confirm both enforce this value.
--
-- Default 'pdf' preserves the previous behavior for every existing document.
-- The CHECK constrains the column to exactly the two allowed formats.
-- =============================================================================

alter table public.required_document_types
  add column if not exists accepted_format text not null default 'pdf'
    check (accepted_format in ('pdf', 'png'));

comment on column public.required_document_types.accepted_format is
  'Accepted upload format for this document, chosen by the admin: pdf | png. The client upload accept attribute and confirmDocumentUpload both enforce it.';
