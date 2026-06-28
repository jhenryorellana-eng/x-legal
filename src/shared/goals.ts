/**
 * Typed accessor over `orgs.settings.goals` (jsonb) — KPI targets the admin sets
 * to compare dashboard metrics against. Lives in `src/shared` so the backend
 * (compare KPI vs goal) and the admin goals UI (edit) both consume it.
 *
 * An unset goal is `null` (never 0): the UI shows no progress bar instead of a
 * misleading "0% of $0" target. Goals are compared period-over-period as a
 * secondary signal alongside the universal delta-vs-previous-period.
 */

export interface OrgGoals {
  /** Monthly revenue target, in cents. */
  monthlyRevenueCents: number | null;
  /** Lead → won conversion target, %. */
  leadConversionPct: number | null;
  /** On-time installments target, %. */
  ontimeInstallmentsPct: number | null;
  /** Monthly AI spend budget, USD. */
  aiBudgetUsd: number | null;
}

/** jsonb key ↔ typed field mapping (snake_case in the DB, camelCase in TS). */
const GOAL_KEYS = {
  monthly_revenue_cents: "monthlyRevenueCents",
  lead_conversion_pct: "leadConversionPct",
  ontime_installments_pct: "ontimeInstallmentsPct",
  ai_budget_usd: "aiBudgetUsd",
} as const;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Resolve goals from a raw `orgs.settings` jsonb value (any shape tolerated). */
export function resolveGoals(settings: unknown): OrgGoals {
  const goals =
    settings && typeof settings === "object" && "goals" in settings
      ? ((settings as { goals?: Record<string, unknown> }).goals ?? {})
      : {};

  const out = {
    monthlyRevenueCents: null,
    leadConversionPct: null,
    ontimeInstallmentsPct: null,
    aiBudgetUsd: null,
  } as OrgGoals;

  for (const [dbKey, field] of Object.entries(GOAL_KEYS)) {
    out[field] = num((goals as Record<string, unknown>)[dbKey]);
  }
  return out;
}
