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

/** Count org appointments in a time window (active statuses) — for "today". */
export async function countAppointmentsInRange(
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<number> {
  const client = createServiceClient();
  const { count, error } = await client
    .from("appointments")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("status", ["scheduled", "completed", "no_show"])
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso);
  if (error) throw error;
  return count ?? 0;
}

/** Uploaded docs awaiting review in the sales rep's cases. */
export async function salesWaitingReview(orgId: string, userId: string): Promise<number> {
  const client = createServiceClient();
  const { data, error } = await client.rpc("analytics_sales_waiting_review", {
    p_org: orgId,
    p_user: userId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** Contracts signed in [from, to) for the sales rep's cases. */
export async function salesClosings(
  orgId: string,
  userId: string,
  fromIso: string,
  toIso: string,
): Promise<number> {
  const client = createServiceClient();
  const { data, error } = await client.rpc("analytics_sales_closings", {
    p_org: orgId,
    p_user: userId,
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * Ledger income/expense totals + income-by-category for a period (org-scoped;
 * ledger_entries has org_id directly). Bounded by the period's transactions, so
 * the small status rows are summed here rather than via an RPC.
 */
export async function ledgerBreakdown(
  orgId: string,
  fromDate: string,
  toDate: string,
): Promise<{ incomeCents: number; expenseCents: number; byCategory: Breakdown[] }> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("ledger_entries")
    .select("kind, category, amount_cents")
    .eq("org_id", orgId)
    .gte("entry_date", fromDate)
    .lte("entry_date", toDate);
  if (error) throw error;
  let incomeCents = 0;
  let expenseCents = 0;
  const cat = new Map<string, number>();
  for (const r of data ?? []) {
    if (r.kind === "income") {
      incomeCents += r.amount_cents;
      cat.set(r.category, (cat.get(r.category) ?? 0) + r.amount_cents);
    } else if (r.kind === "expense") {
      expenseCents += r.amount_cents;
    }
  }
  return {
    incomeCents,
    expenseCents,
    byCategory: [...cat.entries()].map(([key, count]) => ({ key, count })),
  };
}

/**
 * Overdue installment amounts bucketed by age (1–7 / 8–30 / 30+ days late).
 * Uses the SAME "overdue" definition as the finance KPI (status='overdue' OR
 * pending-and-past-due), so the aging chart stays consistent with the morosidad
 * KPI even before the daily cron flips pending→overdue. Bounded set; org-scoped
 * via the nested embed (installments→payment_plans→contracts→cases).
 */
export async function overdueByAge(
  orgId: string,
  todayStr: string,
): Promise<{ recent: number; mid: number; old: number }> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("installments")
    .select("amount_cents, due_date, payment_plans!inner(contracts!inner(cases!inner(org_id)))")
    .eq("payment_plans.contracts.cases.org_id", orgId)
    .or(`status.eq.overdue,and(status.eq.pending,due_date.lt.${todayStr})`);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{ amount_cents: number; due_date: string }>;
  const b = { recent: 0, mid: 0, old: 0 };
  const todayMs = Date.parse(todayStr);
  for (const r of rows) {
    const days = Math.floor((todayMs - Date.parse(r.due_date)) / 86_400_000);
    if (days <= 7) b.recent += r.amount_cents;
    else if (days <= 30) b.mid += r.amount_cents;
    else b.old += r.amount_cents;
  }
  return b;
}

/** Cases handed off INTO a stage to a given owner, in a window (handoffs in). */
export async function countStageReceived(
  userId: string,
  toStage: string,
  fromIso: string,
  toIso: string,
): Promise<number> {
  const client = createServiceClient();
  const { count, error } = await client
    .from("case_stage_history")
    .select("*", { count: "exact", head: true })
    .eq("to_owner_id", userId)
    .eq("to_stage", toStage)
    .gte("created_at", fromIso)
    .lt("created_at", toIso);
  if (error) throw error;
  return count ?? 0;
}

/** Expedientes a paralegal sent to finance in a window (legal throughput out). */
export async function countExpedientesSentToFinance(
  userId: string,
  fromIso: string,
  toIso: string,
): Promise<number> {
  const client = createServiceClient();
  const { count, error } = await client
    .from("expedientes")
    .select("*", { count: "exact", head: true })
    .eq("sent_to_finance_by", userId)
    .gte("sent_to_finance_at", fromIso)
    .lt("sent_to_finance_at", toIso);
  if (error) throw error;
  return count ?? 0;
}

/**
 * A paralegal's own cases grouped by status, scoped to the LEGAL stage (her
 * actual workload — excludes cases she nominally owns but are still pre-legal,
 * e.g. sales-stage/payment_pending). Bounded by one owner's caseload, so the
 * status-only rows are grouped here rather than via a dedicated RPC.
 */
export async function casesByStatusForLegalOwner(
  orgId: string,
  ownerId: string,
): Promise<Breakdown[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("cases")
    .select("status")
    .eq("org_id", orgId)
    .eq("current_owner_id", ownerId)
    .eq("current_stage", "legal");
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key, count }));
}

/** Case-timeline events a staff member authored in a window (own activity). */
export async function countActorActivity(
  userId: string,
  fromIso: string,
  toIso: string,
): Promise<number> {
  const client = createServiceClient();
  const { count, error } = await client
    .from("case_timeline")
    .select("*", { count: "exact", head: true })
    .eq("actor_user_id", userId)
    .gte("occurred_at", fromIso)
    .lt("occurred_at", toIso);
  if (error) throw error;
  return count ?? 0;
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
