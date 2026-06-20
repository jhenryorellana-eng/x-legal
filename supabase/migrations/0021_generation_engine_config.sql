-- 0021_generation_engine_config.sql
-- Feature: generic, admin-configurable legal-generation engine (v1-grade).
--
-- Additive, non-destructive. Extends ai_generation_configs so the SAME ai_letter
-- engine spans the full spectrum: from simple one-shot letters (Visa Juvenil
-- witness/tutor/minor) to v1-grade asylum memoranda (web_search jurisprudence +
-- 17 configurable sections with word floors + anti-invention rules + assembly).
--
--   * web_search_enabled / web_search_max_uses / research_instructions /
--     research_model — live research (jurisprudence + country conditions) via the
--     native Anthropic web_search tool.
--   * sections — ordered array of {key, heading, min_words, max_tokens, guidance,
--     type}. Empty = current single-call behavior (backward compatible).
--   * rules_enabled / rules_text — anti-invention guardrails (R1-R7) injected into
--     the system prompt. Default rules text lives in code (DEFAULT_GENERATION_RULES).
--   * assembly — optional {cover, toc, closing} document assembly config.
--
-- Rollback: DROP the added columns.

ALTER TABLE public.ai_generation_configs
  ADD COLUMN IF NOT EXISTS web_search_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS web_search_max_uses integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS research_instructions text,
  ADD COLUMN IF NOT EXISTS research_model text,
  ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rules_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rules_text text,
  ADD COLUMN IF NOT EXISTS assembly jsonb;

COMMENT ON COLUMN public.ai_generation_configs.sections IS
  'Ordered [{key, heading, min_words, max_tokens, guidance, type}]. Empty = single-call generation.';
COMMENT ON COLUMN public.ai_generation_configs.web_search_enabled IS
  'When true, generation passes the native Anthropic web_search tool (jurisprudence/country-conditions research).';
COMMENT ON COLUMN public.ai_generation_configs.rules_enabled IS
  'When true, inject anti-invention rules (rules_text, or DEFAULT_GENERATION_RULES) into the system prompt.';
