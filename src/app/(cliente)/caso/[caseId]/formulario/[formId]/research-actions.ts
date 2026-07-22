"use server";

/**
 * web_research "Buscar" — per-question interactive web search (buscador + IA).
 *
 * The wizard sends the staff/client's query for one web_research question; ai-engine
 * loads that question's system-prompt template server-side (NEVER accepted from the
 * client), runs Anthropic web_search, and returns the produced address + its web
 * citations. Best-effort: every failure maps to { ok:false } and the read-only result
 * box stays empty.
 *
 * Boundary R1: app → module-pub (identity, ai-engine) only.
 */

import { requireActor } from "@/backend/modules/identity";
import { runFieldWebResearch, AiEngineError } from "@/backend/modules/ai-engine";

export interface ResearchFieldResult {
  ok: boolean;
  address?: string;
  sources?: Array<{ uri: string; title: string | null }>;
  error?: { code: string };
}

export async function researchFieldAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  questionId: string;
  query: string;
}): Promise<ResearchFieldResult> {
  try {
    const actor = await requireActor();
    const r = await runFieldWebResearch(actor, {
      caseId: input.caseId,
      formDefinitionId: input.formDefinitionId,
      questionId: input.questionId,
      query: input.query,
    });
    return { ok: true, address: r.address, sources: r.sources };
  } catch (e) {
    if (e instanceof AiEngineError) return { ok: false, error: { code: e.code } };
    return { ok: false, error: { code: "RESEARCH_FAILED" } };
  }
}
