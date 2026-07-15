/**
 * Lex deterministic insight engine (P-52-07).
 *
 * `buildLexInsight` gathers the candidate insights for a board's role and returns
 * the single highest-priority one (by tone: danger > warn > info > celebrate).
 * Ties keep declared order (Array.prototype.sort is stable). Pure + synchronous —
 * no i18n, no React, no data fetching.
 */
import type { LexContext, LexInsight, LexTone } from "./types";
import { salesCandidates } from "./rules/sales";
import { legalCandidates } from "./rules/legal";
import { financeCandidates } from "./rules/finance";
import { adminCandidates } from "./rules/admin";

const TONE_RANK: Record<LexTone, number> = {
  danger: 0,
  warn: 1,
  info: 2,
  celebrate: 3,
};

function candidatesFor(ctx: LexContext): LexInsight[] {
  switch (ctx.role) {
    case "sales":
      return salesCandidates(ctx);
    case "legal":
      return legalCandidates(ctx);
    case "finance":
      return financeCandidates(ctx);
    case "admin":
      return adminCandidates(ctx);
  }
}

export function buildLexInsight(ctx: LexContext): LexInsight | null {
  const candidates = candidatesFor(ctx);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])[0];
}
