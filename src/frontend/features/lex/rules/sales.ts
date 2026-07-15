/**
 * Lex rules — Vanessa's sales board (`/ventas/mi-dia`).
 *
 * Pure: given the real "mi día" counts, return the candidate insights (declared
 * in priority order). The engine picks the top by tone.
 */
import type { LexInsight, SalesHomeContext } from "../types";

export function salesCandidates(ctx: SalesHomeContext): LexInsight[] {
  const out: LexInsight[] = [];

  if (ctx.uncontacted > 0) {
    out.push({
      id: "sales:priority",
      tone: "warn",
      messageKey: "sales.priority",
      params: { n: ctx.uncontacted, name: ctx.topLeadName ?? "—" },
      actions: [
        {
          id: "contactTopLead",
          labelKey: "actions.contactLead",
          labelParams: { name: ctx.topLeadName ?? "—" },
          icon: "call",
        },
        { id: "openMessaging", labelKey: "actions.openMessaging", icon: "forum", ghost: true },
      ],
    });
  }

  // Fallback (always present): all leads contacted.
  out.push({
    id: "sales:clear",
    tone: "celebrate",
    messageKey: "sales.clear",
    params: {},
    actions: [],
  });

  return out;
}
