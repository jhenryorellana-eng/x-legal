/**
 * Analytics module — repository (read-only data access).
 *
 * Aggregation lives in Postgres: group-bys / time-series / handoffs go through
 * the analytics_* RPCs (migration 0044); scalar counts use PostgREST
 * `count(head)`. The app never pulls rows to tally in JS. All reads are
 * org-scoped via the service client (server-only RSC reads; never client-side).
 */
import { createServiceClient } from "@/backend/platform/supabase";
import { DEFAULT_TZ } from "@/shared/period";
import type { Breakdown, LeadFunnel, TimeSeriesPoint, HandoffCell } from "./types";

const NON_ACTIVE_STATUSES = "(completed,cancelled)";

export interface FinanceKpis {
  incomeCents: number;
  overdueCents: number;
  overdueCount: number;
  overdueCases: number;
}

export interface AiCost {
  totalUsd: number;
  runs: number;
}

/** Org timezone from settings (drives calendar bucketing); falls back to default. */
export async function getOrgTimezone(orgId: string): Promise<string> {
  const client = createServiceClient();
  const { data } = await client.from("orgs").select("settings").eq("id", orgId).single();
  const settings = (data?.settings ?? {}) as { default_timezone?: string };
  return settings.default_timezone ?? DEFAULT_TZ;
}

export async function casesBy(orgId: string, dim: "status" | "stage" | "service"): Promise<Breakdown[]> {
  const client = createServiceClient();
  const { data, error } = await client.rpc("analytics_cases_by", { p_org: orgId, p_dim: dim });
  if (error) throw error;
  return (data ?? []).map((r) => ({ key: r.key ?? "unknown", count: Number(r.count) }));
}

export async function leadFunnel(
  orgId: string,
  userId: string | null,
  fromIso: string,
  toIso: string,
): Promise<LeadFunnel> {
  const client = createServiceClient();
  const { data, error } = await client.rpc("analytics_lead_funnel", {
    p_org: orgId,
    p_from: fromIso,
    p_to: toIso,
    // Omit the optional p_user entirely when null (exactOptionalPropertyTypes
    // rejects an explicit `undefined`); omitting == "all users" to the function.
    ...(userId ? { p_user: userId } : {}),
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    newLeads: Number(row?.new_leads ?? 0),
    contacted: Number(row?.contacted ?? 0),
    won: Number(row?.won ?? 0),
    lost: Number(row?.lost ?? 0),
  };
}

export async function activityByDay(
  orgId: string,
  fromIso: string,
  toIso: string,
  tz: string,
): Promise<TimeSeriesPoint[]> {
  const client = createServiceClient();
  const { data, error } = await client.rpc("analytics_activity_by_day", {
    p_org: orgId,
    p_from: fromIso,
    p_to: toIso,
    p_tz: tz,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    bucketIso: r.bucket ?? "",
    eventType: r.event_type ?? "unknown",
    count: Number(r.count),
  }));
}

export async function handoffsByWeek(
  orgId: string,
  fromIso: string,
  toIso: string,
  tz: string,
): Promise<HandoffCell[]> {
  const client = createServiceClient();
  const { data, error } = await client.rpc("analytics_handoffs_by_week", {
    p_org: orgId,
    p_from: fromIso,
    p_to: toIso,
    p_tz: tz,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    weekIso: r.week ?? "",
    fromStage: r.from_stage ?? "unknown",
    toStage: r.to_stage ?? "unknown",
    count: Number(r.count),
  }));
}

export async function financeKpis(orgId: string, fromDate: string, toDate: string): Promise<FinanceKpis> {
  const client = createServiceClient();
  const { data, error } = await client.rpc("analytics_finance_kpis", {
    p_org: orgId,
    p_from: fromDate,
    p_to: toDate,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    incomeCents: Number(row?.income_cents ?? 0),
    overdueCents: Number(row?.overdue_cents ?? 0),
    overdueCount: Number(row?.overdue_count ?? 0),
    overdueCases: Number(row?.overdue_cases ?? 0),
  };
}

export async function aiCost(orgId: string, fromIso: string, toIso: string): Promise<AiCost> {
  const client = createServiceClient();
  const { data, error } = await client.rpc("analytics_ai_cost", {
    p_org: orgId,
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw error;
  const row = data?.[0];
  return { totalUsd: Number(row?.total_usd ?? 0), runs: Number(row?.runs ?? 0) };
}

/** Count cases, optionally restricted to a creation window and/or open statuses. */
export async function countCases(
  orgId: string,
  opts: { createdFrom?: string; createdTo?: string; activeOnly?: boolean } = {},
): Promise<number> {
  const client = createServiceClient();
  let q = client.from("cases").select("*", { count: "exact", head: true }).eq("org_id", orgId);
  if (opts.activeOnly) q = q.not("status", "in", NON_ACTIVE_STATUSES);
  if (opts.createdFrom) q = q.gte("created_at", opts.createdFrom);
  if (opts.createdTo) q = q.lt("created_at", opts.createdTo);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}
