-- 0105 — ai_generation_configs.mailing_cover (deterministic USPS mailing cover sheet)
--
-- Config-as-data (like 0103's letter_fill / 0102's signature_role): declares a
-- deterministic, NON-AI "Carátula de Envío" (mailing cover sheet) — a one-page
-- US Letter document with one or more envelope blocks (sender return address +
-- recipient), used as the mailing front sheet of a filing package (e.g. the BIA
-- appeal, served to the Board of Immigration Appeals and to DHS/OPLA).
--
-- The PRESENCE of this config is the single discriminator that:
--   1. routes the generation to the deterministic render path (no LLM call), and
--   2. marks the generated document as a mailing COVER — prepended as the
--      unnumbered first sheet of the compiled expediente (before the index),
--      and excluded from the normal expediente body assembly.
--
-- Additive and nullable: null = ordinary ai_letter (prior behavior). Shape is
-- validated in application code (catalog MailingCoverConfigSchema / ai-engine
-- MailingCoverConfig), not by the DB.

alter table public.ai_generation_configs
  add column if not exists mailing_cover jsonb;

comment on column public.ai_generation_configs.mailing_cover is
  'Deterministic USPS mailing cover sheet (return_address / sender_name / envelopes[] / spacing). Presence routes generation to the no-LLM render path and prepends the sheet before the expediente index. Null = ordinary ai_letter.';
