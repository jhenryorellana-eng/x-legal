"use server";

/**
 * Form response management server actions (API-CASE-18/19 — staff surface).
 *
 * Shared by the case workspace "Formularios" tab (Ver / Generar / Revisión) and
 * the side-by-side review screen. Moved here from the removed standalone
 * `admin/casos/[caseId]/formularios/` route (Henry 2026-07-07 consolidation).
 *
 * approveFormResponse: transitions submitted → approved (gate before PDF).
 * generateFilledPdf: resolves all sources, fills AcroForm, stores PDF, returns URL.
 *
 * Boundary R1/R2: app → module-pub (cases/index) only.
 */

import { requireActor, AuthzError } from "@/backend/modules/identity";
import {
  approveFormResponse,
  generateFilledPdf,
  getFormResponsePdfUrl,
  getCaseExtractions,
  staffUpdateFormAnswers,
  CaseError,
} from "@/backend/modules/cases";
import { startGeneration, AiEngineError } from "@/backend/modules/ai-engine";
import { classifySaveError } from "@/frontend/features/form-wizard/classify-save-error";

export interface ApproveFormResult {
  ok: boolean;
  error?: { code: string };
}

/**
 * Staff approves a submitted form response (submitted → approved).
 * Required before generating the PDF when filled_by='client'.
 *
 * @api-id API-CASE-18
 */
export async function approveFormResponseAction(input: {
  responseId: string;
}): Promise<ApproveFormResult> {
  try {
    const actor = await requireActor();
    await approveFormResponse(actor, { responseId: input.responseId });
    return { ok: true };
  } catch (err) {
    if (err instanceof CaseError) {
      return { ok: false, error: { code: err.code } };
    }
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

export interface GeneratePdfResult {
  ok: boolean;
  downloadUrl?: string;
  error?: { code: string; details?: Record<string, unknown> };
}

/**
 * Generates a filled PDF for the form response and returns a signed download URL.
 *
 * @api-id API-CASE-19
 */
export async function generateFilledPdfAction(input: {
  responseId: string;
}): Promise<GeneratePdfResult> {
  try {
    const actor = await requireActor();
    const downloadUrl = await generateFilledPdf(actor, { responseId: input.responseId });
    return { ok: true, downloadUrl };
  } catch (err) {
    if (err instanceof CaseError) {
      return {
        ok: false,
        error: { code: err.code, details: err.details },
      };
    }
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

/**
 * Staff edit of a form response's answers (side-by-side review), allowed in any
 * status. Gated by the `formEdit` permission (staffUpdateFormAnswers). Injected as
 * the FormWizard's `saveDraft` when the review is editable, so it reuses the exact
 * client autosave engine (debounce + durable IndexedDB write-ahead + offline queue).
 */
export async function staffUpdateFormAnswersAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  patch: Record<string, unknown>;
}): Promise<{ ok: boolean; responseId?: string; retryable?: boolean; error?: { code: string; details?: Record<string, unknown> } }> {
  try {
    const actor = await requireActor();
    const response = await staffUpdateFormAnswers(actor, {
      caseId: input.caseId,
      formDefinitionId: input.formDefinitionId,
      partyId: input.partyId,
      patch: input.patch,
    });
    return { ok: true, responseId: response.id };
  } catch (err) {
    // Missing the formEdit permission → permanent, not retryable.
    if (err instanceof AuthzError) return { ok: false, retryable: false, error: { code: "FORBIDDEN" } };
    const code = err instanceof CaseError ? err.code : "UNEXPECTED";
    const retryable = classifySaveError(code) === "transient";
    if (err instanceof CaseError) return { ok: false, retryable, error: { code: err.code, details: err.details } };
    return { ok: false, retryable, error: { code: "UNEXPECTED" } };
  }
}

export interface StartGenerationResultDto {
  ok: boolean;
  /** "over_80" | "over_100" when the org is near/over its AI budget (non-blocking). */
  budgetWarning?: string | null;
  error?: { code: string };
}

/**
 * Launch an ai_letter generation run for a case form (carta IA). startGeneration
 * handles the duplicate-active-run guard and budget check. Diana/admin/staff with
 * cases:edit.
 *
 * @api-id API-AI-01
 */
export async function startGenerationAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId?: string | null;
}): Promise<StartGenerationResultDto> {
  try {
    const actor = await requireActor();
    const res = await startGeneration(actor, {
      caseId: input.caseId,
      formDefinitionId: input.formDefinitionId,
      partyId: input.partyId ?? null,
    });
    return { ok: true, budgetWarning: res.budgetWarning };
  } catch (err) {
    if (err instanceof AiEngineError || err instanceof CaseError) {
      return { ok: false, error: { code: err.code } };
    }
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

/**
 * Read-only signed URL of a form response's official filled PDF (or null if not
 * generated yet). Used by the side-by-side review screen's left panel and the
 * "Fases anteriores" tab.
 */
export async function getFormResponsePdfUrlAction(input: {
  responseId: string;
}): Promise<{ ok: boolean; url?: string | null; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const url = await getFormResponsePdfUrl(actor, input.responseId);
    return { ok: true, url };
  } catch (err) {
    if (err instanceof CaseError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

export interface CaseExtractionsResult {
  ok: boolean;
  extractions?: Awaited<ReturnType<typeof getCaseExtractions>>;
  error?: { code: string };
}

/**
 * Returns document extraction statuses for the staff Información tab.
 */
export async function getCaseExtractionsAction(input: {
  caseId: string;
}): Promise<CaseExtractionsResult> {
  try {
    const actor = await requireActor();
    const extractions = await getCaseExtractions(actor, input.caseId);
    return { ok: true, extractions };
  } catch (err) {
    if (err instanceof CaseError) {
      return { ok: false, error: { code: err.code } };
    }
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}
