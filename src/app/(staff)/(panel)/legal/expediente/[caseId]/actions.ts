"use server";

/**
 * Ensamblador de expediente — server actions (paralegal Diana / staff surface).
 *
 * Each action wraps the corresponding use case from the expediente module-pub
 * boundary. Returns `{ ok: true, data }` or `{ ok: false, error: { code } }`.
 * Mirror pattern: admin/casos/form-actions.ts.
 */

import { requireActor } from "@/backend/modules/identity";
import {
  createExpediente,
  generateCover,
  addItem,
  removeItem,
  reorderItems,
  updateItem,
  compileExpediente,
  getCompiledPdfUrl,
  createCorrectionAttempt,
  autoAssembleWithAi,
  deleteCoverItem,
  regenerateCover,
  sendToFinance,
  ExpedienteError,
  type ExpedienteRow,
  type CoverRenderRow,
  type AutoAssembleResult,
} from "@/backend/modules/expediente";
import { AiEngineError } from "@/backend/modules/ai-engine";
import {
  retryExhibit,
  createExhibitUploadUrl,
  confirmManualExhibit,
  ExhibitsError,
} from "@/backend/modules/exhibits";

// ---------------------------------------------------------------------------
// Shared result shapes
// ---------------------------------------------------------------------------

export interface ExpedienteResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

// ---------------------------------------------------------------------------
// Exhibits panel (Diana) — retry a failed exhibit / upload a manual copy
// ---------------------------------------------------------------------------

export async function retryExhibitAction(input: { exhibitId: string }): Promise<ExpedienteResult> {
  try {
    const actor = await requireActor();
    await retryExhibit(actor, input.exhibitId);
    return { ok: true };
  } catch (err) {
    if (err instanceof ExhibitsError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

export async function createExhibitUploadUrlAction(input: {
  exhibitId: string;
}): Promise<ExpedienteResult<{ signedUrl: string; path: string }>> {
  try {
    const actor = await requireActor();
    const data = await createExhibitUploadUrl(actor, input.exhibitId);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ExhibitsError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

export async function confirmManualExhibitAction(input: {
  exhibitId: string;
  path: string;
}): Promise<ExpedienteResult> {
  try {
    const actor = await requireActor();
    await confirmManualExhibit(actor, input);
    return { ok: true };
  } catch (err) {
    if (err instanceof ExhibitsError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// createExpedienteAction  (API-EXP-05)
// ---------------------------------------------------------------------------

export async function createExpedienteAction(input: {
  caseId: string;
}): Promise<ExpedienteResult<ExpedienteRow>> {
  try {
    const actor = await requireActor();
    const data = await createExpediente(actor, { caseId: input.caseId });
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// generateCoverAction  (API-EXP-02)
// ---------------------------------------------------------------------------

export async function generateCoverAction(input: {
  caseId: string;
  templateId: string;
  data: Record<string, unknown>;
}): Promise<ExpedienteResult<CoverRenderRow>> {
  try {
    const actor = await requireActor();
    const cover = await generateCover(actor, {
      caseId: input.caseId,
      templateId: input.templateId,
      data: input.data,
    });
    return { ok: true, data: cover };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// addItemAction  (API-EXP-07)
// ---------------------------------------------------------------------------

export async function addItemAction(input: {
  expedienteId: string;
  itemType: "cover" | "ai_generation" | "automated_form" | "client_document" | "external_file";
  refId?: string;
  title: string;
  includeInToc?: boolean;
}): Promise<ExpedienteResult> {
  try {
    const actor = await requireActor();
    await addItem(actor, {
      expedienteId: input.expedienteId,
      itemType: input.itemType,
      refId: input.refId,
      title: input.title,
      includeInToc: input.includeInToc,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// removeItemAction  (API-EXP-08)
// ---------------------------------------------------------------------------

export async function removeItemAction(input: {
  itemId: string;
}): Promise<ExpedienteResult> {
  try {
    const actor = await requireActor();
    await removeItem(actor, input.itemId);
    return { ok: true };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// reorderItemsAction  (API-EXP-09)
// ---------------------------------------------------------------------------

export async function reorderItemsAction(input: {
  expedienteId: string;
  orderedItemIds: string[];
}): Promise<ExpedienteResult> {
  try {
    const actor = await requireActor();
    await reorderItems(actor, {
      expedienteId: input.expedienteId,
      orderedItemIds: input.orderedItemIds,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// updateItemAction  (API-EXP-10)
// ---------------------------------------------------------------------------

export async function updateItemAction(input: {
  itemId: string;
  title?: string;
  includeInToc?: boolean;
}): Promise<ExpedienteResult> {
  try {
    const actor = await requireActor();
    await updateItem(actor, {
      itemId: input.itemId,
      title: input.title,
      includeInToc: input.includeInToc,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// compileExpedienteAction  (API-EXP-12)
// ---------------------------------------------------------------------------

export async function compileExpedienteAction(input: {
  expedienteId: string;
}): Promise<ExpedienteResult<{ compiledPdfPath: string; pageCount: number }>> {
  try {
    const actor = await requireActor();
    const data = await compileExpediente(actor, input.expedienteId);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// getCompiledPdfUrlAction  (API-EXP-13)
// ---------------------------------------------------------------------------

export async function getCompiledPdfUrlAction(input: {
  expedienteId: string;
}): Promise<ExpedienteResult<string>> {
  try {
    const actor = await requireActor();
    const url = await getCompiledPdfUrl(actor, input.expedienteId);
    return { ok: true, data: url };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// createCorrectionAttemptAction  (API-EXP-14)
// ---------------------------------------------------------------------------

export async function createCorrectionAttemptAction(input: {
  expedienteId: string;
}): Promise<ExpedienteResult<ExpedienteRow>> {
  try {
    const actor = await requireActor();
    const data = await createCorrectionAttempt(actor, input.expedienteId);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// autoAssembleWithAiAction  (API-EXP-17) — AI builds the full ordered draft
// ---------------------------------------------------------------------------

export async function autoAssembleWithAiAction(input: {
  caseId: string;
  replace?: boolean;
}): Promise<ExpedienteResult<AutoAssembleResult>> {
  try {
    const actor = await requireActor();
    const data = await autoAssembleWithAi(actor, input.caseId, { replace: input.replace });
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    if (err instanceof AiEngineError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// sendToFinanceAction  (API-EXP-...) — hand off to Andrium (printing)
// ---------------------------------------------------------------------------

export async function sendToFinanceAction(input: {
  caseId: string;
  expedienteId: string;
}): Promise<ExpedienteResult> {
  try {
    const actor = await requireActor();
    await sendToFinance(actor, { caseId: input.caseId, expedienteId: input.expedienteId });
    return { ok: true };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// deleteCoverItemAction  (API-EXP-15) — remove a cover + its render
// ---------------------------------------------------------------------------

export async function deleteCoverItemAction(input: {
  itemId: string;
}): Promise<ExpedienteResult> {
  try {
    const actor = await requireActor();
    await deleteCoverItem(actor, input.itemId);
    return { ok: true };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// regenerateCoverAction  (API-EXP-16) — re-render a cover with corrected data
// ---------------------------------------------------------------------------

export async function regenerateCoverAction(input: {
  itemId: string;
  title?: string;
  subtitle?: string;
  partyId?: string | null;
}): Promise<ExpedienteResult<CoverRenderRow>> {
  try {
    const actor = await requireActor();
    const data = await regenerateCover(actor, {
      itemId: input.itemId,
      title: input.title,
      subtitle: input.subtitle,
      partyId: input.partyId,
    });
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}
