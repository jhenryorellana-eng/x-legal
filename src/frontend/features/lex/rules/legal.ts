/**
 * Lex rules — Diana's legal board (`/legal`).
 *
 * Pure: derives candidates from the board-alert aggregates. Priority:
 * overdue RFE (danger) → lawyer corrections → docs to review → failed
 * generations (warn) → all-clear (info).
 */
import type { LegalHomeContext, LexInsight } from "../types";

export function legalCandidates(ctx: LegalHomeContext): LexInsight[] {
  const out: LexInsight[] = [];

  if (ctx.rfeOverdue > 0) {
    out.push({
      id: "legal:rfe",
      tone: "danger",
      messageKey: "legal.rfeOverdue",
      params: { n: ctx.rfeOverdue },
      actions: [{ id: "viewCases", labelKey: "actions.viewCases", href: "/legal", icon: "gavel" }],
    });
  }

  if (ctx.corrections > 0) {
    out.push({
      id: "legal:corrections",
      tone: "warn",
      messageKey: "legal.corrections",
      params: { n: ctx.corrections },
      actions: [{ id: "viewCases", labelKey: "actions.viewCases", href: "/legal", icon: "gavel" }],
    });
  }

  if (ctx.docsToReview > 0) {
    out.push({
      id: "legal:docs",
      tone: "warn",
      messageKey: "legal.docsToReview",
      params: { n: ctx.docsToReview, cases: ctx.docsCases },
      actions: [
        {
          id: "openReviewQueue",
          labelKey: "actions.openReviewQueue",
          href: "/legal/por-revisar",
          icon: "fact_check",
        },
      ],
    });
  }

  if (ctx.failedGen > 0) {
    out.push({
      id: "legal:gen",
      tone: "warn",
      messageKey: "legal.failedGen",
      params: { n: ctx.failedGen },
      actions: [{ id: "viewCases", labelKey: "actions.viewCases", href: "/legal", icon: "gavel" }],
    });
  }

  // Fallback (always present): no alerts.
  out.push({
    id: "legal:clear",
    tone: "info",
    messageKey: "legal.clear",
    params: { active: ctx.activeCases },
    actions: [],
  });

  return out;
}
