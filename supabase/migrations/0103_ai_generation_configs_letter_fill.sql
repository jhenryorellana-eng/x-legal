-- 0103 — ai_generation_configs.letter_fill (deterministic court-letter token fills)
--
-- Config-as-data (like 0102's signature_role): declares how renderAndStore
-- resolves an ai_letter's placeholder tokens from the case's confirmed form
-- answers / document extractions, so critical facts — the appellant's mailing
-- address, the government's (OCC) service address, the chosen service method —
-- are stamped deterministically by code instead of transcribed by the model.
--
-- Additive and nullable: null = no deterministic fill (prior behavior). Shape is
-- validated in application code (ai-engine LetterFillConfig), not by the DB.

alter table public.ai_generation_configs
  add column if not exists letter_fill jsonb;

comment on column public.ai_generation_configs.letter_fill is
  'Deterministic token fills for court letters (appellant_contact / occ_address / service_method). Resolved in ai-engine renderAndStore from confirmed answers + extractions. Null = none.';
