"use server";

/**
 * Ensamblador de expediente — server actions (paralegal Diana / staff surface).
 *
 * Each action wraps the corresponding use case from the expediente module-pub
 * boundary. Returns `{ ok: true, data }` or `{ ok: false, error: { code } }`.
 * Mirror pattern: admin/casos/[caseId]/formularios/actions.ts.
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
  ExpedienteError,
  type ExpedienteRow,
  type CoverRenderRow,
} from "@/backend/modules/expediente";

// ---------------------------------------------------------------------------
// Shared result shapes
// ---------------------------------------------------------------------------

export interface ExpedienteResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
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
