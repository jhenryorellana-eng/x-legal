"use server";

/**
 * Client evaluation screen server actions (Evaluación — external tool v1: Juez).
 *
 * Thin "use server" wrappers over the evaluations module-pub actions (which build
 * the Actor + authorize + create the session lazily). Boundary: app → module-pub.
 * The screen polls `refreshClientEvaluationAction` while a run is in progress and
 * calls `getClientEvaluationPdfUrlAction` to open the delivered PDF.
 */

import {
  getClientEvaluationStateAction,
  getClientEvaluationPdfUrlAction as getClientEvaluationPdfUrl,
} from "@/backend/modules/evaluations";

/** Re-reads the client's evaluation state (also creates the session on first call). */
export async function refreshClientEvaluationAction(caseId: string) {
  return getClientEvaluationStateAction(caseId);
}

/** Signed URL of the delivered evaluation PDF. */
export async function getClientEvaluationPdfUrlAction(caseId: string) {
  return getClientEvaluationPdfUrl(caseId);
}
