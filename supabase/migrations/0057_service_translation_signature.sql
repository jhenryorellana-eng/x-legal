-- 0057_service_translation_signature.sql
-- Per-service certified-translation signing config: the signer's name and a
-- signature image (stored in the `catalog-assets` bucket). The ai-engine
-- translation job stamps these onto the certification block of the generated
-- translation PDF ("I, {name}, hereby certify…" + the signature image).
-- Optional (NULL) — a service without it yields an unsigned (impersonal)
-- certification, the prior behavior. Additive; no RLS change (services already
-- scoped by org via existing policies).

alter table public.services
  add column if not exists translation_signer_name text,
  add column if not exists translation_signature_path text;

comment on column public.services.translation_signer_name is
  'Certified-translation signer name shown in the "I, {name}, hereby certify…" line.';
comment on column public.services.translation_signature_path is
  'Path in the catalog-assets bucket of the signature image (PNG/JPG) stamped on the translation PDF.';

-- The translation signature is an image; allow PNG/JPG in the catalog-assets bucket
-- (it previously accepted only PDF/text). The app-level allowlist (platform/storage.ts)
-- must agree; this is the Supabase storage bucket's own MIME restriction.
update storage.buckets
set allowed_mime_types = array['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg']
where id = 'catalog-assets';
