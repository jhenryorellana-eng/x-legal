-- 0102_case_signatures_config.sql
-- Config-as-data for "case signatures": a per-case client signature image (stored
-- as a required document in the `case-documents` bucket) that gets stamped onto the
-- generated artifacts of a service package where a signer's signature belongs.
--
-- Symmetry: `required_document_types.signature_role` marks the SOURCE (which uploaded
-- document is a given signer's signature image), while `ai_generation_configs.signature_role`
-- (ai_letter destination) and `form_automation_versions.signature_placements` (pdf_automation
-- destination) mark WHERE that role's signature is stamped. The join key is a free-text role
-- slug (e.g. 'appellant') — no CHECK to a fixed enum, so new signers/services (co-appellant,
-- spouse, preparer, translator) are pure data, no migration.
--
-- Additive; no RLS change (the three tables are already scoped by org/service via existing
-- policies). Mirrors the per-service translator signature (0057) but sources the image from a
-- case document instead of a service config.

-- 1. SOURCE — mark a required document as a signer's signature image.
alter table public.required_document_types
  add column if not exists signature_role text;

comment on column public.required_document_types.signature_role is
  'When set (e.g. ''appellant''), this required document IS a signer''s signature image (accepted_format=''png''), used to stamp generated artifacts and EXCLUDED from the assembled expediente. NULL = a normal filed document.';

-- At most one signature source per (phase, role): the resolver assumes a single head.
create unique index if not exists required_document_types_one_signature_role_per_phase
  on public.required_document_types (service_phase_id, signature_role)
  where signature_role is not null;

-- 2. DESTINATION (ai_letter) — a generated letter is signed by this role at its closing block.
alter table public.ai_generation_configs
  add column if not exists signature_role text;

comment on column public.ai_generation_configs.signature_role is
  'When set (e.g. ''appellant''), the generated ai_letter carries a deterministic signature block; the case''s signature image for that role is stamped on it at render. NULL = unsigned (prior behavior).';

-- 3. DESTINATION (pdf_automation) — where each role's signature is stamped on the AcroForm.
-- Shape: [{ "role": "appellant", "page": 3, "rect": [x0,y0,x1,y1] }, ...]. `page`/`rect`
-- come from this same version's detected_fields (mupdf top-left space); the EOIR-26 signature
-- widgets are UNNAMED, so placements reference them by page+rect, not by pdf_field_name.
-- Versioned with the PDF (survives field re-detection); read from `published` in generateFilledPdf
-- with no extra JOIN.
alter table public.form_automation_versions
  add column if not exists signature_placements jsonb not null default '[]'::jsonb;

comment on column public.form_automation_versions.signature_placements is
  'Signature stamp targets for this PDF version: [{role, page, rect:[x0,y0,x1,y1]}] in detected_fields (mupdf top-left) coordinates. Empty = no signature stamped (prior behavior).';
