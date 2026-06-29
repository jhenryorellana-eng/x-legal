-- =============================================================================
-- 0047_sales_today_rpcs.sql
-- Scalar aggregations for Vanessa's "Mi día" KPIs that cross tables (case_documents
-- → cases, contracts → cases) and so can't be a PostgREST count(head). Keeps the
-- aggregation in Postgres (analytics module, RNF-043). The "today appointments"
-- KPI is a single-table count(head) and stays in the repository (no RPC needed).
--
-- SQL, STABLE, SECURITY DEFINER, search_path='', service_role only.
-- Depends on: 0004 (cases, case_documents), 0005 (contracts).
-- =============================================================================

-- Clients waiting review: uploaded docs in the sales rep's cases ------------------
create or replace function public.analytics_sales_waiting_review(p_org uuid, p_user uuid)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select count(*)::bigint
  from public.case_documents d
  join public.cases c on c.id = d.case_id
  where c.org_id = p_org
    and c.assigned_sales_id = p_user
    and d.status = 'uploaded';
$$;

-- Closings: contracts signed in [from, to) for the rep's cases --------------------
create or replace function public.analytics_sales_closings(
  p_org uuid, p_user uuid, p_from timestamptz, p_to timestamptz)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select count(*)::bigint
  from public.contracts ct
  join public.cases c on c.id = ct.case_id
  where c.org_id = p_org
    and c.assigned_sales_id = p_user
    and ct.signed_at is not null
    and ct.signed_at >= p_from and ct.signed_at < p_to;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.analytics_sales_waiting_review(uuid, uuid)',
    'public.analytics_sales_closings(uuid, uuid, timestamptz, timestamptz)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
