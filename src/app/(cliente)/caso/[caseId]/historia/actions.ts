"use server";

/**
 * Mi Historia server actions (API-CASE-16/17 — client surface).
 *
 * Thin "use server" wrappers over the cases module-pub use cases. Mi Historia is
 * an `ai_letter` form; it shares the exact same autosave/submit surface as the
 * generic wizard (the engine is identical — DOC-50 §6).
 *
 * Boundary R1/R2: app → module-pub (cases/index) only.
 */

import { requireActor } from "@/backend/modules/identity";
import { saveFormDraft, submitFormResponse, CaseError } from "@/backend/modules/cases";
import { classifySaveError } from "@/frontend/features/form-wizard/classify-save-error";

export interface SaveDraftResult {
  ok: boolean;
  responseId?: string;
  /** Whether a failed save is worth retrying (autosave engine policy). */
  retryable?: boolean;
  error?: { code: string; details?: Record<string, unknown> };
}

/** @api-id API-CASE-16 */
export async function saveDraftAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  patch: Record<string, unknown>;
}): Promise<SaveDraftResult> {
  try {
    const actor = await requireActor();
    const response = await saveFormDraft(actor, {
      caseId: input.caseId,
      formDefinitionId: input.formDefinitionId,
      partyId: input.partyId,
      patch: input.patch,
    });
    return { ok: true, responseId: response.id };
  } catch (err) {
    const code = err instanceof CaseError ? err.code : "UNEXPECTED";
    const retryable = classifySaveError(code) === "transient";
    if (err instanceof CaseError) {
      return { ok: false, retryable, error: { code: err.code, details: err.details } };
    }
    return { ok: false, retryable, error: { code: "UNEXPECTED" } };
  }
}

export interface SubmitFormResult {
  ok: boolean;
  responseId?: string;
  error?: { code: string; details?: Record<string, unknown> };
}

/** @api-id API-CASE-17 */
export async function submitFormAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
}): Promise<SubmitFormResult> {
  try {
    const actor = await requireActor();
    const response = await submitFormResponse(actor, {
      caseId: input.caseId,
      formDefinitionId: input.formDefinitionId,
      partyId: input.partyId,
    });
    return { ok: true, responseId: response.id };
  } catch (err) {
    if (err instanceof CaseError) {
      return { ok: false, error: { code: err.code, details: err.details } };
    }
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}
