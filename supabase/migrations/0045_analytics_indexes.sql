-- =============================================================================
-- 0045_analytics_indexes.sql
-- Indexes on the hot columns the dashboard aggregations filter/group by, so the
-- analytics RPCs (0044) and count(head) reads stay <500ms at scale (RNF-043).
-- All `if not exists`; composites lead with org_id (the universal tenant filter).
-- A few single-column indexes already exist (0037: current_stage/current_owner;
-- case_stage_history(case_id,created_at)) — those are intentionally not repeated.
-- =============================================================================

-- cases — dimension breakdowns + period filters + owner scoping ------------------
create index if not exists cases_org_status_idx        on public.cases (org_id, status);
create index if not exists cases_org_stage_idx         on public.cases (org_id, current_stage);
create index if not exists cases_org_service_idx       on public.cases (org_id, service_id);
create index if not exists cases_org_created_idx       on public.cases (org_id, created_at);
create index if not exists cases_org_completed_idx     on public.cases (org_id, completed_at)
  where completed_at is not null;
create index if not exists cases_org_sales_idx         on public.cases (org_id, assigned_sales_id);
create index if not exists cases_org_paralegal_idx     on public.cases (org_id, assigned_paralegal_id);

-- handoffs / activity — join by case, filter by date -----------------------------
create index if not exists case_stage_history_owner_idx on public.case_stage_history (to_owner_id, created_at);
create index if not exists case_timeline_case_time_idx  on public.case_timeline (case_id, occurred_at);
create index if not exists case_timeline_time_type_idx  on public.case_timeline (occurred_at, event_type);

-- leads — funnel + sources + assignment ------------------------------------------
create index if not exists leads_org_status_idx        on public.leads (org_id, status);
create index if not exists leads_org_created_idx       on public.leads (org_id, created_at);
create index if not exists leads_org_source_idx        on public.leads (org_id, source);
create index if not exists leads_org_assigned_idx      on public.leads (org_id, assigned_to, created_at);

-- contracts — closures delta (signed_at) -----------------------------------------
create index if not exists contracts_org_signed_idx    on public.contracts (org_id, signed_at)
  where signed_at is not null;

-- billing --------------------------------------------------------------------------
create index if not exists installments_status_due_idx on public.installments (status, due_date);
create index if not exists ledger_org_kind_date_idx    on public.ledger_entries (org_id, kind, entry_date);
create index if not exists payments_status_conf_idx    on public.payments (status, confirmed_at);

-- scheduling / IA / expediente ---------------------------------------------------
create index if not exists appointments_staff_starts_idx on public.appointments (staff_id, starts_at);
create index if not exists appointments_status_starts_idx on public.appointments (status, starts_at);
create index if not exists ai_runs_case_created_idx    on public.ai_generation_runs (case_id, created_at)
  where is_test = false;
create index if not exists expedientes_status_idx      on public.expedientes (status);
