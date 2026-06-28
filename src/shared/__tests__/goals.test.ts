/**
 * resolveGoals — typed accessor over orgs.settings.goals (jsonb).
 *
 * Goals are optional targets the admin sets to compare KPIs against. An unset
 * goal is `null` (NOT 0) so the UI shows no progress bar rather than a
 * misleading "0% of $0" target.
 */
import { describe, it, expect } from "vitest";
import { resolveGoals } from "../goals";

describe("resolveGoals", () => {
  it("returns all-null when settings has no goals", () => {
    expect(resolveGoals({})).toEqual({
      monthlyRevenueCents: null,
      leadConversionPct: null,
      ontimeInstallmentsPct: null,
      aiBudgetUsd: null,
    });
  });

  it("reads set goals and leaves the rest null", () => {
    const g = resolveGoals({ goals: { monthly_revenue_cents: 500000, lead_conversion_pct: 25 } });
    expect(g.monthlyRevenueCents).toBe(500000);
    expect(g.leadConversionPct).toBe(25);
    expect(g.ontimeInstallmentsPct).toBeNull();
    expect(g.aiBudgetUsd).toBeNull();
  });

  it("ignores non-numeric / garbage values", () => {
    const g = resolveGoals({ goals: { monthly_revenue_cents: "lots", ai_budget_usd: 300 } });
    expect(g.monthlyRevenueCents).toBeNull();
    expect(g.aiBudgetUsd).toBe(300);
  });

  it("tolerates null/undefined settings", () => {
    expect(resolveGoals(null).monthlyRevenueCents).toBeNull();
    expect(resolveGoals(undefined).aiBudgetUsd).toBeNull();
  });
});
