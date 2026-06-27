-- =============================================================================
-- 0039_documents_multiple_and_display_name.sql
-- Two additive document capabilities:
--
-- 1) required_document_types.allow_multiple — the admin marks a required document
--    as "multiple" so the client may upload more than one file for it (e.g.
--    "Evidencias"). Default false preserves the single-file behavior for every
--    existing requirement. The DB already allows many case_documents per
--    (case, requirement, party) — there is no unique constraint — so this flag
--    only drives application logic (no auto-replace) + the client UI.
--
-- 2) case_documents.display_name — a human-friendly, semantic name for the
--    uploaded document. For single required slots the server derives it from the
--    requirement label + party ("Pasaporte de Juan"); for multiple/free uploads
--    the client types it ("reporte policial"). It drives the download filename
--    (slugified → "pasaporte-de-juan.pdf"). original_filename is preserved as the
--    raw upload name (audit / traceability).
-- =============================================================================

alter table public.required_document_types
  add column if not exists allow_multiple boolean not null default false;
comment on column public.required_document_types.allow_multiple is
  'Admin flag: client may upload more than one file for this requirement (e.g. "Evidencias"). Unlimited.';

alter table public.case_documents
  add column if not exists display_name text;
comment on column public.case_documents.display_name is
  'Human-friendly name for the document. Single slot: derived from requirement label + party. Multiple/free: client-typed. Drives the download filename; original_filename keeps the raw upload name.';
