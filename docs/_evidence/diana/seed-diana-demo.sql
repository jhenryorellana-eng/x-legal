-- Diana (paralegal, user 00000000-0000-0000-0000-000000000003) demo seed.
-- Purpose: give Diana a populated cases kanban + reviewable work so the dashboard
-- is demonstrable end-to-end (move cards, "Por revisar" queue, Mi día pendientes).
-- All data is DEMO (no real PII). Idempotent: safe to run more than once.
--
-- Applied via Supabase MCP apply_migration (write to production) with Henry's
-- explicit authorization this turn. Cards are projected by backfillCasesBoard()
-- on the next /legal load (no kanban_cards inserted here).

-- 1) Hand ownership of the three unowned demo cases to Diana so her board has
--    several cards to organise across columns.
update public.cases
set current_owner_id = '00000000-0000-0000-0000-000000000003'
where case_number in ('ULP-2026-0009', 'ULP-2026-0012', 'ULP-2026-0013')
  and current_owner_id is null;

-- 2) Mark the two most recent documents of ULP-2026-0011 (already Diana's, has a
--    draft expediente) as 'uploaded' so the "Por revisar" banner/queue and the
--    Mi día "Revisar documentos" pendiente have real data. Always the same two
--    documents (ordered by created_at) → idempotent.
update public.case_documents
set status = 'uploaded'
where id in (
  select id
  from public.case_documents
  where case_id = '35023394-b5b7-43cc-9111-5fcf865a9e6f'
  order by created_at desc
  limit 2
);
