/**
 * Lex rules — Henry's org dashboard (`/admin`).
 *
 * Pure: org morosidad (danger) → biggest conversion leak, computed from the real
 * lead funnel (warn) → all-in-order (celebrate). The leak replaces the previous
 * hardcoded "Contactado → Cita agendada" claim: it is derived from actual counts.
 */
import { biggestFunnelLeak } from "../funnel";
import type { AdminHomeContext, LexInsight } from "../types";

export function adminCandidates(ctx: AdminHomeContext): LexInsight[] {
  const out: LexInsight[] = [];

  if (ctx.overdueCases > 0) {
    out.push({
      id: "admin:overdue",
      tone: "danger",
      messageKey: "admin.overdue",
      params: { n: ctx.overdueCases, amount: ctx.overdueAmount },
      actions: [{ id: "viewFinance", labelKey: "actions.viewFinance", href: "/finanzas", icon: "wallet" }],
    });
  }

  // Biggest real leak across the 3-stage lead funnel (leads → contacted → won).
  const leak = biggestFunnelLeak([
    { label: ctx.stageLabels.leads, count: ctx.funnel.newLeads },
    { label: ctx.stageLabels.contacted, count: ctx.funnel.contacted },
    { label: ctx.stageLabels.won, count: ctx.funnel.won },
  ]);
  if (leak) {
    out.push({
      id: "admin:leak",
      tone: "warn",
      messageKey: "admin.leak",
      params: { from: leak.from, to: leak.to, drop: leak.drop, conv: ctx.conversionLabel },
      actions: [],
    });
  }

  // Fallback (always present): no morosidad, no meaningful leak.
  out.push({
    id: "admin:clear",
    tone: "celebrate",
    messageKey: "admin.clear",
    params: { active: ctx.activeCases, conv: ctx.conversionLabel },
    actions: [],
  });

  return out;
}
