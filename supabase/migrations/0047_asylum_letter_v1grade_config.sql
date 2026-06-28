-- 0047_asylum_letter_v1grade_config.sql
--
-- Configures the "Memorándum de Miedo Creíble" (Asilo Político, Fase 2
-- "Reforzar") ai_letter to use the v1-grade engine end-to-end:
--   • research_model = Opus (analysis + verified jurisprudence + country
--     conditions, gathered once and persisted in config_snapshot.research).
--   • model = Sonnet for the 17 drafting sections (rate-limit friendly, faster,
--     cheaper — matches v1's split).
--   • assembly = court-grade document: cover page + TOC + chronology table +
--     a penalty-of-perjury closing/signature block.
--
-- Data-only, idempotent, additive. The same knobs are editable from the admin
-- form-editor (Generación avanzada → Ensamblado) for any future letter.

update public.ai_generation_configs c
set model          = 'claude-sonnet-4-6',
    research_model  = 'claude-opus-4-7',
    assembly        = jsonb_build_object(
      'cover', true,
      'toc', true,
      'chronology', true,
      'closing',
        'I declare under penalty of perjury under the laws of the United States of America '
        || 'that the foregoing is true and correct to the best of my knowledge and belief.'
        || E'\n\nSignature: ______________________________    Date: __________________'
    ),
    updated_at      = now()
from public.form_definitions fd
where fd.id = c.form_definition_id
  and fd.slug = 'memorandum-de-miedo-creible';
