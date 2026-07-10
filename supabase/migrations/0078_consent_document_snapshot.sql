-- ============================================================
-- 0078_consent_document_snapshot.sql
-- Make the signed in-app consent downloadable as a full document (DOC-51 §12).
--
-- Until now the "Descargar consentimiento firmado" button only served the
-- signature image: contract_terms_acceptances stored `signature_image_path`
-- (a PDF wrapping the signature) but NOT the consent text the client read and
-- accepted. This adds:
--   - document_snapshot: the exact consent text shown to the client, frozen at
--     acceptance time (title + numbered sections + closing, per locale). Like
--     contracts.document_snapshot, an immutable legal record for non-repudiation.
--   - signed_pdf_path: cache for the lazily-assembled consent PDF (text +
--     embedded signature), mirroring contracts.signed_pdf_path. Written by
--     service_role on first download.
--
-- Depends on: 0005_contracts. Additive only — both columns nullable, so legacy
-- acceptances (no snapshot) keep working (the renderer falls back to the current
-- disclaimer text). No RLS change: UPDATE stays denied to authenticated
-- (immutable evidence); the service_role cache write bypasses RLS.
-- ============================================================

alter table public.contract_terms_acceptances
  add column if not exists document_snapshot jsonb,
  add column if not exists signed_pdf_path text;

comment on column public.contract_terms_acceptances.document_snapshot is
  'Frozen consent text the client accepted ({ locale, title, sections:[{title,body}], closing }). Immutable legal record for the downloadable signed consent (DOC-51 §12).';

comment on column public.contract_terms_acceptances.signed_pdf_path is
  'Cache path (contracts bucket) for the assembled consent PDF (text + embedded signature). Rendered lazily + written by service_role on first download.';
