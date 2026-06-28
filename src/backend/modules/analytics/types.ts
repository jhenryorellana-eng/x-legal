/**
 * Analytics module — DTO contracts (raw numbers, no formatting).
 *
 * These are the read-model shapes the dashboards consume. Formatting (money,
 * %, em-dash, delta direction) happens in the page→ViewModel mapping, never
 * here. `ScalarKpi.value === null` means "genuinely unknown" → renders as "—".
 */
import type { Period } from "@/shared/period";

/** A metric plus its previous-period value, for period-over-period deltas. */
export interface ScalarKpi {
  value: number | null;
  prev: number | null;
}

/** One slice of a group-by (cases by status/stage/service, etc.). */
export interface Breakdown {
  key: string;
  count: number;
}

/** One point of an activity time-series (bucketed by org-local day). */
export interface TimeSeriesPoint {
  /** Local calendar day, yyyy-MM-dd. */
  bucketIso: string;
  eventType: string;
  count: number;
}

export interface LeadFunnel {
  newLeads: number;
  contacted: number;
  won: number;
  lost: number;
}

/** One role→role handoff bucketed by ISO week start (yyyy-MM-dd). */
export interface HandoffCell {
  weekIso: string;
  fromStage: string;
  toStage: string;
  count: number;
}

export interface DashboardInput {
  period: Period;
  from?: string;
  to?: string;
}

/** Admin global overview (`/admin`). Org-wide, no role-scoping. */
export interface AdminOverview {
  /** Current open cases (stock) — status not in completed/cancelled. */
  activeCases: number;
  /** Cases created in the period (flow) + prev. */
  newCases: ScalarKpi;
  incomeCents: ScalarKpi;
  /** Lead conversion % (won / new leads) — null when no leads. */
  conversionPct: ScalarKpi;
  aiCostUsd: ScalarKpi;
  overdue: { cents: number; count: number; cases: number };
  casesByStatus: Breakdown[];
  casesByStage: Breakdown[];
  casesByService: Breakdown[];
  funnel: LeadFunnel;
  activity: TimeSeriesPoint[];
  handoffs: HandoffCell[];
}
