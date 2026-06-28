-- =============================================================================
-- 0044_analytics_rpcs.sql
-- Read-model aggregation functions for the staff dashboards (module `analytics`).
-- Pushes KPI aggregation into Postgres (group-by / date_trunc / conditional
-- counts) so the app never pulls rows to tally in JS (RNF-043: aggregates <500ms).
--
-- All functions: SQL, STABLE, SECURITY DEFINER, search_path='' (every reference
-- schema-qualified), callable only by service_role (the dashboards read via the
-- service client in RSC; never exposed to anon/authenticated /rpc).
-- Depends on: 0037 (cases.current_stage, case_stage_history), 0006 (billing),
--             0013 (audit), 0017 (ai_generation_runs).
-- Bucketing takes the org timezone as a parameter (p_tz) — never hardcoded.
-- =============================================================================

-- (a) Cases grouped by a dimension: 'status' | 'stage' | 'service' ---------------
create or replace function public.analytics_cases_by(p_org uuid, p_dim text)
returns table(key text, count bigint)
language sql stable security definer set search_path = ''
as $$
  select case p_dim
           when 'status'  then status
           when 'stage'   then current_stage
           when 'service' then service_id::text
         end as key,
         count(*)::bigint
  from public.cases
  where org_id = p_org
  group by 1;
$$;

-- (b) Lead funnel for a period (p_user null = whole org / admin) ------------------
-- p_user defaults to null (org-wide / admin). Defaults make the generated TS
-- Args optional so the repository can pass `p_user: undefined` for the org view.
create or replace function public.analytics_lead_funnel(
  p_org uuid, p_user uuid default null,
  p_from timestamptz default null, p_to timestamptz default null)
returns table(new_leads bigint, contacted bigint, won bigint, lost bigint)
language sql stable security definer set search_path = ''
as $$
  select
    count(*)::bigint,
    count(*) filter (where contacted_at is not null)::bigint,
    count(*) filter (where status = 'won' or won_case_id is not null)::bigint,
    count(*) filter (where status = 'lost')::bigint
  from public.leads
  where org_id = p_org
    and (p_user is null or assigned_to = p_user)
    and created_at >= p_from and created_at < p_to;
$$;

-- (c) Activity time-series from the unified case_timeline (bucketed by org TZ) ----
create or replace function public.analytics_activity_by_day(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_tz text)
returns table(bucket date, event_type text, count bigint)
language sql stable security definer set search_path = ''
as $$
  select (ct.occurred_at at time zone p_tz)::date as bucket,
         ct.event_type,
         count(*)::bigint
  from public.case_timeline ct
  join public.cases c on c.id = ct.case_id
  where c.org_id = p_org
    and ct.occurred_at >= p_from and ct.occurred_at < p_to
  group by 1, 2
  order by 1;
$$;

-- (d) Handoffs between roles per week (admin star KPI) ---------------------------
create or replace function public.analytics_handoffs_by_week(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_tz text)
returns table(week date, from_stage text, to_stage text, count bigint)
language sql stable security definer set search_path = ''
as $$
  select date_trunc('week', (h.created_at at time zone p_tz))::date as week,
         h.from_stage, h.to_stage, count(*)::bigint
  from public.case_stage_history h
  join public.cases c on c.id = h.case_id
  where c.org_id = p_org
    and h.created_at >= p_from and h.created_at < p_to
  group by 1, 2, 3
  order by 1;
$$;

-- (e) Finance KPIs (replaces the .reduce() in billing/repository.ts) -------------
-- Overdue = status 'overdue' OR (pending AND past due) — matches how the demo /
-- cron leaves installments (pending+past-due rather than a flipped status).
create or replace function public.analytics_finance_kpis(
  p_org uuid, p_from date, p_to date)
returns table(income_cents bigint, overdue_cents bigint,
              overdue_count bigint, overdue_cases bigint)
language sql stable security definer set search_path = ''
as $$
  select
    coalesce((
      select sum(amount_cents) from public.ledger_entries
      where org_id = p_org and kind = 'income'
        and entry_date >= p_from and entry_date <= p_to
    ), 0)::bigint,
    coalesce(sum(i.amount_cents) filter (where i.status = 'overdue'
              or (i.status = 'pending' and i.due_date < current_date)), 0)::bigint,
    count(*) filter (where i.status = 'overdue'
              or (i.status = 'pending' and i.due_date < current_date))::bigint,
    count(distinct ct.case_id) filter (where i.status = 'overdue'
              or (i.status = 'pending' and i.due_date < current_date))::bigint
  from public.installments i
  join public.payment_plans pp on pp.id = i.payment_plan_id
  join public.contracts ct on ct.id = pp.contract_id
  join public.cases c on c.id = ct.case_id and c.org_id = p_org;
$$;

-- (f) AI cost for a period (excludes is_test; grouped by model) -------------------
-- ai_generation_runs has NO org_id → scoped via case → org.
create or replace function public.analytics_ai_cost(
  p_org uuid, p_from timestamptz, p_to timestamptz)
returns table(total_usd numeric, runs bigint, by_model jsonb)
language sql stable security definer set search_path = ''
as $$
  with g as (
    select coalesce(r.model, 'unknown') as model,
           sum(r.cost_usd) as cost, count(*) as n
    from public.ai_generation_runs r
    join public.cases c on c.id = r.case_id
    where c.org_id = p_org and r.is_test = false
      and r.created_at >= p_from and r.created_at < p_to
    group by 1
  )
  select coalesce(sum(cost), 0)::numeric,
         coalesce(sum(n), 0)::bigint,
         coalesce(jsonb_object_agg(model, cost), '{}'::jsonb)
  from g;
$$;

-- Grants: service_role only (dashboards read via the service client). ------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.analytics_cases_by(uuid, text)',
    'public.analytics_lead_funnel(uuid, uuid, timestamptz, timestamptz)',
    'public.analytics_activity_by_day(uuid, timestamptz, timestamptz, text)',
    'public.analytics_handoffs_by_week(uuid, timestamptz, timestamptz, text)',
    'public.analytics_finance_kpis(uuid, date, date)',
    'public.analytics_ai_cost(uuid, timestamptz, timestamptz)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
