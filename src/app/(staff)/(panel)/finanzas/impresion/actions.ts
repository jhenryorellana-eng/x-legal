"use server";

/**
 * Cola de impresión — server actions (Andrium / finance surface).
 *
 * Wraps the expediente module-pub boundary for the three steps of the
 * print cycle (RF-AND-025/026/027) and the signed-URL fetch (RF-AND-024).
 * Returns `{ ok: true, data? } | { ok: false, error: { code } }`.
 *
 * Mirror pattern: legal/expediente/[caseId]/actions.ts
 */

import { requireActor } from "@/backend/modules/identity";
import {
  markPrinted,
  markShipped,
  markFiled,
  getCompiledPdfUrl,
  ExpedienteError,
} from "@/backend/modules/expediente";

// ---------------------------------------------------------------------------
// Shared result shape
// ---------------------------------------------------------------------------

export interface PrintActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

// ---------------------------------------------------------------------------
// markPrintedAction  (API-EXP-16, RF-AND-025)
// ---------------------------------------------------------------------------

/**
 * Marks expediente as `printed` (sent_to_finance → printed).
 * Exige compiled_pdf_path no nulo.
 */
export async function markPrintedAction(
  expedienteId: string,
): Promise<PrintActionResult> {
  try {
    const actor = await requireActor();
    await markPrinted(actor, expedienteId);
    return { ok: true };
  } catch (err) {
    if (err instanceof ExpedienteError)
      return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// markShippedAction  (API-EXP-17, RF-AND-026)
// ---------------------------------------------------------------------------

/**
 * Records physical shipment. Status stays `printed`; writes shipped_at +
 * optional tracking_ref.
 */
export async function markShippedAction(
  expedienteId: string,
  trackingRef?: string,
): Promise<PrintActionResult> {
  try {
    const actor = await requireActor();
    await markShipped(actor, expedienteId, trackingRef);
    return { ok: true };
  } catch (err) {
    if (err instanceof ExpedienteError)
      return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// markFiledAction  (API-EXP-18, RF-AND-027)
// ---------------------------------------------------------------------------

/**
 * Records court/USCIS filing. Status stays `printed`; writes filed_at.
 */
export async function markFiledAction(
  expedienteId: string,
): Promise<PrintActionResult> {
  try {
    const actor = await requireActor();
    await markFiled(actor, expedienteId);
    return { ok: true };
  } catch (err) {
    if (err instanceof ExpedienteError)
      return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// getExpedientePdfUrlAction  (API-EXP-13 reuse, RF-AND-024)
// ---------------------------------------------------------------------------

/**
 * Returns a short-lived signed URL for the compiled PDF of the given expediente.
 *
 * TODO API-EXP-19: upstream listPrintQueue should expose hasPdf; if false, this
 * action is unreachable from the UI (actions are disabled). The URL is fetched
 * lazily when the PDF viewer modal opens.
 */
export async function getExpedientePdfUrlAction(
  expedienteId: string,
): Promise<PrintActionResult<string>> {
  try {
    const actor = await requireActor();
    const url = await getCompiledPdfUrl(actor, expedienteId);
    return { ok: true, data: url };
  } catch (err) {
    if (err instanceof ExpedienteError)
      return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}
