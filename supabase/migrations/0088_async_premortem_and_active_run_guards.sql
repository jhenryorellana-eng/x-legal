-- 0088 — Async Pre-Mortem (QStash job) + atomic single-active-run guards
--
-- A) case_pre_mortem_assessments gains an async lifecycle: rows are inserted
--    'queued' by the enqueue action, claimed 'running' by the job, and finish
--    'completed'/'failed'. Existing rows (all fully-written reports) backfill
--    to 'completed' via the column default. score/semaforo/verdict/model are
--    already nullable, so queued rows need no NOT NULL relaxation.
-- B) Partial unique index = the atomic concurrency guard per ARTIFACT
--    (target_kind + run_id|response_id). Keyed per artifact, not per form:
--    the table has no party_id, and a per-form key would block validating
--    party B's letter while party A's is in flight.
-- C) Defensive sweep of stale active generation runs so index D builds clean.
-- D) Same atomic guard for ai_generation_runs: one active run per
--    (case, form, party). Closes the findActiveRun read-then-insert TOCTOU.

-- A) Async lifecycle columns
alter table public.case_pre_mortem_assessments
  add column status     text not null default 'completed'
    check (status in ('queued','running','completed','failed')),
  add column started_at timestamptz,
  add column error      text,
  add column updated_at timestamptz not null default now();

drop trigger if exists trg_premortem_updated_at on public.case_pre_mortem_assessments;
create trigger trg_premortem_updated_at
  before update on public.case_pre_mortem_assessments
  for each row execute function public.set_updated_at();

-- B) One active validation per artifact
create unique index uq_premortem_active_target
  on public.case_pre_mortem_assessments (target_kind, coalesce(run_id, response_id))
  where status in ('queued','running');

-- C) Sweep stale active runs (>2h without a checkpoint touch = dead)
update public.ai_generation_runs
  set status = 'failed',
      error = coalesce(error, '0088: stale active run swept at migration'),
      updated_at = now()
  where status in ('queued','running')
    and updated_at < now() - interval '2 hours';

-- D) One active generation run per (case, form, party)
create unique index uq_ai_runs_active_target
  on public.ai_generation_runs
    (case_id, form_definition_id, coalesce(party_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('queued','running');
