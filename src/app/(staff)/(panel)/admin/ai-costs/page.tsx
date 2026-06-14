/**
 * AI costs dashboard — /admin/ai-costs (RF-ADM-005).
 *
 * Server Component: reads the cost summary (total · by source · by month) via
 * the ai-engine module-pub read for the current calendar month, renders the
 * dashboard. Budget comes from the org settings (falls back to a default).
 */

import { redirect } from "next/navigation";
import { getActor } from "@/backend/modules/identity";
import { getCostsSummary } from "@/backend/modules/ai-engine";
import { AiCostsView, type AiCostsVM } from "@/frontend/features/admin/ai-costs";

const DEFAULT_MONTHLY_BUDGET_USD = 500;

export default async function AiCostsPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  // Current month window.
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const to = now.toISOString();

  const summary = await getCostsSummary(actor, { from, to });

  const vm: AiCostsVM = {
    totalUsd: summary.totalUsd,
    bySource: summary.bySource,
    byMonth: summary.byMonth,
    budgetUsd: DEFAULT_MONTHLY_BUDGET_USD,
    from,
    to,
  };

  return <AiCostsView vm={vm} />;
}
