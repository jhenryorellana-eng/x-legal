"use server";

/**
 * "Mejorar con IA" — per-question answer rewrite (T5).
 *
 * The wizard sends the CURRENT text of one question; ai-engine loads the
 * question's ai_improve.instruction server-side (never accepted from the
 * client), masks PII reversibly, calls the T5 model and returns the improved
 * text. Best-effort: every failure maps to { ok:false } and the wizard leaves
 * the client's text untouched.
 *
 * Boundary R1: app → module-pub (identity, ai-engine) only.
 */

import { requireActor } from "@/backend/modules/identity";
import { improveFormAnswerText, AiEngineError } from "@/backend/modules/ai-engine";

export interface ImproveAnswerResult {
  ok: boolean;
  improvedText?: string;
  error?: { code: string };
}

export async function improveAnswerAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  questionId: string;
  text: string;
}): Promise<ImproveAnswerResult> {
  try {
    const actor = await requireActor();
    const r = await improveFormAnswerText(actor, {
      caseId: input.caseId,
      formDefinitionId: input.formDefinitionId,
      questionId: input.questionId,
      text: input.text,
    });
    return { ok: true, improvedText: r.improvedText };
  } catch (e) {
    if (e instanceof AiEngineError) return { ok: false, error: { code: e.code } };
    return { ok: false, error: { code: "IMPROVE_FAILED" } };
  }
}
