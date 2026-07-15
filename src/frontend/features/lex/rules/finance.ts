/**
 * Lex rules — Andrium's collections board (`/finanzas`).
 *
 * Pure: derives candidates from collection metrics + print queue. Priority:
 * overdue cases (danger) → print queue (warn) → collected-this-month nudge
 * (info) → clean ledger (celebrate).
 */
import type { FinanceHomeContext, LexInsight } from "../types";

export function financeCandidates(ctx: FinanceHomeContext): LexInsight[] {
  const out: LexInsight[] = [];

  if (ctx.overdueCases > 0) {
    out.push({
      id: "finance:overdue",
      tone: "danger",
      messageKey: "finance.overdue",
      params: { n: ctx.overdueCases, amount: ctx.overdueAmount },
      actions: [
        { id: "viewOverdue", labelKey: "actions.viewOverdue", href: "/finanzas/pagos", icon: "warning" },
      ],
    });
  }

  if (ctx.printQueue > 0) {
    out.push({
      id: "finance:print",
      tone: "warn",
      messageKey: "finance.print",
      params: { n: ctx.printQueue },
      actions: [
        { id: "viewPrintQueue", labelKey: "actions.viewPrintQueue", href: "/finanzas/impresion", icon: "print" },
      ],
    });
  }

  if (ctx.collectedCents > 0) {
    out.push({
      id: "finance:collected",
      tone: "info",
      messageKey: "finance.collected",
      params: { amount: ctx.collectedAmount, trend: ctx.collectedTrendLabel ?? "—" },
      actions: [],
    });
  }

  // Fallback (always present): nothing overdue.
  out.push({
    id: "finance:clear",
    tone: "celebrate",
    messageKey: "finance.clear",
    params: {},
    actions: [],
  });

  return out;
}
