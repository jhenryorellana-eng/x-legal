-- Extraction digest — a bounded, page-cited summary of the whole document,
-- computed once at extraction for documents too large to fit the generation
-- char budget verbatim. Downstream (buildCaseContextBlocks) uses it to COVER the
-- middle of a large document instead of head-tail clipping it into a black hole.
--
-- Additive and nullable: pre-digest extractions keep digest_text = NULL and the
-- generation prompt falls back to the legacy head-tail clip, so this migration is
-- safe to apply ahead of the code and the code degrades cleanly when it is absent.
alter table public.document_extractions
  add column if not exists digest_text text;

comment on column public.document_extractions.digest_text is
  'Bounded, page-cited digest of the full document (Gemini, faithful/temp 0), '
  'computed at extraction for large scans. Covers the middle of a document that '
  'exceeds the generation char budget so no section is dropped. NULL = pre-digest '
  'extraction; downstream falls back to the head-tail clip.';
