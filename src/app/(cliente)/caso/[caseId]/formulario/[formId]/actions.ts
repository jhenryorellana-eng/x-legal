"use server";

/**
 * Form wizard server actions (API-CASE-16/17 — client surface).
 *
 * Thin "use server" wrappers over the cases module-pub use cases.
 * getFormForClient is a Server Component read (not a server action).
 *
 * Boundary R1/R2: app → module-pub (cases/index) only.
 */

import { requireActor } from "@/backend/modules/identity";
import {
  saveFormDraft,
  submitFormResponse,
  getAiFieldPrefill,
  CaseError,
} from "@/backend/modules/cases";
import { classifySaveError } from "@/frontend/features/form-wizard/classify-save-error";

export interface SaveDraftResult {
  ok: boolean;
  responseId?: string;
  /** Whether a failed save is worth retrying (the client trusts this over its own
   *  classifier). Computed from the same policy the engine uses. */
  retryable?: boolean;
  error?: { code: string; details?: Record<string, unknown> };
}

/**
 * Autosaves a partial answer patch for the wizard.
 * Returns the updated responseId (created on first save).
 *
 * @api-id API-CASE-16
 */
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

/**
 * Light cache read for the wizard's ai_field prefill polling (Ola perf): the
 * open renders instantly with `prefillPending` shimmers and this action patches
 * the values in as the background warm job lands them. No provider calls.
 */
export async function getAiPrefillAction(input: {
  caseId: string;
  questionIds: string[];
  partyId: string | null;
}): Promise<{ ok: boolean; values?: Record<string, string> }> {
  try {
    const actor = await requireActor();
    const values = await getAiFieldPrefill(actor, {
      caseId: input.caseId,
      questionIds: input.questionIds,
      partyId: input.partyId,
    });
    return { ok: true, values };
  } catch {
    return { ok: false };
  }
}

/**
 * Submits a completed form response.
 * Server-side validates all required fields before transitioning to submitted.
 *
 * @api-id API-CASE-17
 */
export async function submitFormAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  answersTranslated?: Record<string, string>;
  translationStatus?: "none" | "partial" | "pending_server" | "done";
}): Promise<SubmitFormResult> {
  try {
    const actor = await requireActor();
    const response = await submitFormResponse(actor, {
      caseId: input.caseId,
      formDefinitionId: input.formDefinitionId,
      partyId: input.partyId,
      answersTranslated: input.answersTranslated,
      translationStatus: input.translationStatus,
    });
    return { ok: true, responseId: response.id };
  } catch (err) {
    if (err instanceof CaseError) {
      return { ok: false, error: { code: err.code, details: err.details } };
    }
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}
