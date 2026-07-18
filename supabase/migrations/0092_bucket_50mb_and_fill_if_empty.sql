-- 0092 — (a) case-documents bucket cap 25MB → 50MB (versioned; the live UPDATE
-- was applied 2026-07-17 with Henry's authorization — this keeps migration
-- history and fresh environments in sync with UPLOAD_MAX_FILE_BYTES), and
-- (b) atomic "fill only if empty" merge for AI-draft materialization at submit
-- time — the application-level snapshot merge raced the client's atomic
-- autosave (merge_form_answers) and could overwrite a just-saved answer with
-- an AI draft. This RPC closes that TOCTOU window server-side: a draft only
-- lands on keys that are absent or empty AT WRITE TIME.

update storage.buckets set file_size_limit = 52428800 where id = 'case-documents';

create or replace function public.merge_form_answers_if_empty(
  p_response_id uuid,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_answers jsonb;
begin
  update public.case_form_responses r
  set answers = coalesce(r.answers, '{}'::jsonb) || (
        select coalesce(jsonb_object_agg(p.key, p.value), '{}'::jsonb)
        from jsonb_each(p_patch) as p(key, value)
        where not (coalesce(r.answers, '{}'::jsonb) ? p.key)
           or coalesce(r.answers ->> p.key, '') = ''
      ),
      updated_at = now()
  where r.id = p_response_id
  returning r.answers into v_answers;
  return v_answers;
end;
$$;

comment on function public.merge_form_answers_if_empty(uuid, jsonb) is
  'Atomic draft materialization: merges only the patch keys that are still absent/empty at write time (a concurrent client autosave always wins). Returns the final answers.';

revoke all on function public.merge_form_answers_if_empty(uuid, jsonb) from anon, authenticated;
