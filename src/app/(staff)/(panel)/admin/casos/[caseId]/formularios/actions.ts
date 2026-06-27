"use server";

/**
 * Form response management server actions (API-CASE-18/19 — staff surface).
 *
 * approveFormResponse: transitions submitted → approved (gate before PDF).
 * generateFilledPdf: resolves all sources, fills AcroForm, stores PDF, returns URL.
 *
 * Boundary R1/R2: app → module-pub (cases/index) only.
 */

import { requireActor } from "@/backend/modules/identity";
import {
  approveFormResponse,
  generateFilledPdf,
  getFormResponsePdfUrl,
  getCaseExtractions,
  CaseError,
} from "@/backend/modules/cases";
import { startGeneration, AiEngineError } from "@/backend/modules/ai-engine";

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

export interface StartGenerationResultDto {
  ok: boolean;
  /** "over_80" | "over_100" when the org is near/over its AI budget (non-blocking). */
  budgetWarning?: string | null;
  error?: { code: string };
}

/**
 * Launch an ai_letter generation run for a case form (carta IA). Used by the
 * forms manager for `kind='ai_letter'` rows (startGeneration handles the
 * duplicate-active-run guard and budget check). Diana/admin/staff with cases:edit.
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
 * generated yet). Used by the side-by-side review screen's left panel.
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
