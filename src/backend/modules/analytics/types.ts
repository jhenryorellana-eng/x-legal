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

/** Diana's legal performance dashboard (paralegal-scoped, period-over-period). */
export interface LegalDashboard {
  /** Cases handed off into legal stage to this paralegal. */
  received: ScalarKpi;
  /** Expedientes this paralegal sent to finance (throughput out). */
  sentToFinance: ScalarKpi;
  /** Case-timeline events this paralegal authored (own activity). */
  activity: ScalarKpi;
  /** Her cases by status — scoped to the LEGAL stage (her actual workload). */
  casesByStatus: Breakdown[];
}

/** Andrium's finance/operations overview (org-wide, period-over-period). */
export interface FinanceDashboard {
  /** Income collected in the period (ledger income). */
  income: ScalarKpi;
  overdue: { cents: number; count: number; cases: number };
  /** Ledger totals for the period (balance = income − expense). */
  ledgerIncomeCents: number;
  ledgerExpenseCents: number;
  /** Income broken down by ledger category (Breakdown.count holds cents). */
  incomeByCategory: Breakdown[];
  /** Overdue amount (cents) bucketed by age — same definition as the KPI. */
  overdueByAge: { recent: number; mid: number; old: number };
}

/** Vanessa's "Mi día" live counts (sales-scoped). */
export interface SalesToday {
  /** Org appointments scheduled for today (shared agenda). */
  todayAppointments: number;
  /** Uploaded docs awaiting review in this rep's cases. */
  waitingReview: number;
  /** Contracts signed this week for this rep's cases. */
  closingsThisWeek: number;
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
