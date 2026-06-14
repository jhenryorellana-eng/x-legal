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
  getCaseExtractions,
  CaseError,
} from "@/backend/modules/cases";

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
