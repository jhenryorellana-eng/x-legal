-- 0089 — Chunked OCR extraction checkpoint (large scanned documents).
--
-- Large PDFs (>30 pages / >15MB) are OCR'd in page-range chunks; each chunk's
-- text is checkpointed here so a QStash retry or a self-chained invocation
-- resumes at the first missing chunk instead of re-paying completed ones.
-- Shape: { kind: 'chunked', page_count, chunk_pages,
--          parts: { "0": "<text>", ... }, usage: { input_tokens, output_tokens } }
-- Cleared (NULL) when the extraction completes.

alter table public.document_extractions
  add column if not exists progress jsonb;

comment on column public.document_extractions.progress is
  'Chunked-OCR checkpoint for large documents: {kind:"chunked", page_count, chunk_pages, parts:{"<i>":"<text>"}, usage}. NULL once completed.';
