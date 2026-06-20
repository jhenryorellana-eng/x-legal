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
  CaseError,
} from "@/backend/modules/cases";

export interface SaveDraftResult {
  ok: boolean;
  responseId?: string;
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
    if (err instanceof CaseError) {
      return { ok: false, error: { code: err.code, details: err.details } };
    }
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

export interface SubmitFormResult {
  ok: boolean;
  responseId?: string;
  error?: { code: string; details?: Record<string, unknown> };
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
