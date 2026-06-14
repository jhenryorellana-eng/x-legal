-- Migration 0018: atomic JSONB merge for case_form_responses.answers (ADDITIVE)
--
-- Why: form autosave merges a patch of answers into the existing jsonb. The
-- app-level read-modify-write has a race window under simultaneous saves
-- (multi-device / multi-tab) that can drop a concurrent write's keys. This RPC
-- does the merge in a single atomic statement (`answers || patch`), satisfying
-- RF-DIA-023 CA2 (last-write-wins PER KEY) without application locking.
--
-- The repository (cases/mergeFormAnswers) calls this RPC and falls back to the
-- read-modify-write path when this migration is not applied, so the code is
-- correct either way; applying this migration only removes the race window.
--
-- SECURITY DEFINER + granted to service_role only (the ai-engine/cases service
-- client is the sole writer of this table — DOC-30 single-writer rule).
--
-- Rollback:  DROP FUNCTION IF EXISTS public.merge_form_answers(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.merge_form_answers(
  p_response_id uuid,
  p_patch       jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.case_form_responses
     SET answers    = coalesce(answers, '{}'::jsonb) || p_patch,
         updated_at = now()
   WHERE id = p_response_id;
$$;

REVOKE ALL ON FUNCTION public.merge_form_answers(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.merge_form_answers(uuid, jsonb) TO service_role;
