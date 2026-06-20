-- 0020_form_answer_translation.sql
-- Feature: client answer translation (Chrome Translator API + Gemini fallback).
--
-- Additive, non-destructive. Adds:
--   * form_automation_versions.source_language — language of the official PDF
--     (AcroForm). Default 'en' preserves current behavior (USCIS forms are EN).
--   * case_form_responses.answers_translated — answers translated to the PDF's
--     source language for AcroForm filling. NEVER overwrites `answers` (the
--     client keeps seeing what they typed in their own language).
--   * case_form_responses.translation_status — lifecycle of that translation.
--
-- The feature degrades without this migration: generateFilledPdf translates
-- on-demand in memory, so the filled PDF is always correct; these columns only
-- add per-form source language + a persisted cache.
--
-- Rollback: DROP the three columns (no data loss beyond the cache).

ALTER TABLE public.form_automation_versions
  ADD COLUMN IF NOT EXISTS source_language text NOT NULL DEFAULT 'en'
    CHECK (source_language IN ('en', 'es'));

ALTER TABLE public.case_form_responses
  ADD COLUMN IF NOT EXISTS answers_translated jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS translation_status text NOT NULL DEFAULT 'none'
    CHECK (translation_status IN ('none', 'partial', 'pending_server', 'done'));

COMMENT ON COLUMN public.form_automation_versions.source_language IS
  'Language of the official PDF/AcroForm (en|es). Drives answer translation when the client locale differs.';
COMMENT ON COLUMN public.case_form_responses.answers_translated IS
  'Answers translated to the form source_language for AcroForm filling. Keyed by question id. Never overwrites answers.';
COMMENT ON COLUMN public.case_form_responses.translation_status IS
  'none | partial | pending_server | done — lifecycle of answers_translated.';
