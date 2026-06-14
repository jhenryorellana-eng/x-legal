-- Migration 0017: ai-engine F4-1 additions (ADDITIVE — no destructive changes)
--
-- Changes:
--   1. ai_generation_runs.progress jsonb — checkpoint for chunked generation (DOC-42 §2.4)
--      NOTE: progress column already exists in database.types.ts (0002 included it);
--            this migration is a no-op guard (IF NOT EXISTS pattern via DO block).
--   2. document_extractions: input_tokens, output_tokens — token tracking (DOC-74 §P-74-3)
--   3. document_translations: input_tokens, output_tokens — token tracking (DOC-74 §P-74-3)
--   4. orgs.settings comment: documents ai_budget_usd key (DOC-74 §P-74-2)
--   5. ai_generation_configs.model CHECK relaxed to include claude-opus-4-7 / claude-sonnet-4-6
--
-- Code functions correctly whether or not this migration is applied:
--   - progress: code reads from payload+Storage as fallback (DOC-42 §2.4)
--   - input_tokens/output_tokens: already present in database.types.ts (0002)
--   - model CHECK: new models added to whitelist in shared/constants/ai-models.ts
--
-- Rollback:
--   ALTER TABLE document_extractions DROP COLUMN IF EXISTS input_tokens, DROP COLUMN IF EXISTS output_tokens;
--   ALTER TABLE document_translations DROP COLUMN IF EXISTS input_tokens, DROP COLUMN IF EXISTS output_tokens;
--   (progress column rollback: no-op if it was already there)

-- ---------------------------------------------------------------------------
-- 1. document_extractions — add token columns (P-74-3)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_extractions' AND column_name = 'input_tokens'
  ) THEN
    ALTER TABLE public.document_extractions
      ADD COLUMN input_tokens integer,
      ADD COLUMN output_tokens integer;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. document_translations — add token columns (P-74-3)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_translations' AND column_name = 'input_tokens'
  ) THEN
    ALTER TABLE public.document_translations
      ADD COLUMN input_tokens integer,
      ADD COLUMN output_tokens integer;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. ai_generation_runs.progress — ensure column exists (DOC-42 §2.4)
--    Already in 0002 per database.types.ts; guard here for safety.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_generation_runs' AND column_name = 'progress'
  ) THEN
    ALTER TABLE public.ai_generation_runs
      ADD COLUMN progress jsonb;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. orgs.settings — comment documenting ai_budget_usd key (P-74-2)
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.orgs.settings IS
  'JSONB settings object. Known keys: branding (object), ai_budget_usd (number, USD/month budget for AI spending — DOC-74 §5.3, RF-ADM-049).';

-- ---------------------------------------------------------------------------
-- 5. ai_generation_configs.model CHECK — relax to allow F4-1 models
--    Drop existing CHECK if it exists and is too narrow, re-add with new list.
--    Uses DO block to check constraint name first (constraint names vary).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  -- Find any CHECK constraint on ai_generation_configs.model
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.ai_generation_configs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%model%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.ai_generation_configs DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  -- Re-add with the full F4-1 model whitelist
  ALTER TABLE public.ai_generation_configs
    ADD CONSTRAINT ai_generation_configs_model_check
    CHECK (model IN (
      'claude-fable-5',
      'claude-sonnet-4-6',
      'claude-opus-4-7',
      'claude-haiku-4-5'
    ));
END $$;
