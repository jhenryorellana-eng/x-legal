"use server";

/**
 * Validaciones [caseId] — server actions (paralegal Diana / staff surface).
 *
 * Thin wrappers around integrations + expediente module use cases.
 * Returns `{ ok: true, data }` or `{ ok: false, error: { code } }`.
 * Mirror pattern: expediente/[caseId]/actions.ts.
 */

import { requireActor } from "@/backend/modules/identity";
import {
  sendToLawyer,
  IntegrationsError,
} from "@/backend/modules/integrations";
import {
  createCorrectionAttempt,
  sendToFinance,
  ExpedienteError,
  type ExpedienteRow,
} from "@/backend/modules/expediente";

// ---------------------------------------------------------------------------
// Shared result shape
// ---------------------------------------------------------------------------

export interface ValidacionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

// ---------------------------------------------------------------------------
// sendToLawyerAction  (RF-DIA-038)
// ---------------------------------------------------------------------------

export async function sendToLawyerAction(input: {
  caseId: string;
  expedienteId: string;
}): Promise<ValidacionResult<{ validationId: string; external: string | null }>> {
  try {
    const actor = await requireActor();
    const data = await sendToLawyer(actor, {
      caseId: input.caseId,
      expedienteId: input.expedienteId,
    });
    return { ok: true, data };
  } catch (err) {
    if (err instanceof IntegrationsError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// createCorrectionAttemptAction  (API-EXP-14)
// ---------------------------------------------------------------------------

export async function createCorrectionAttemptAction(input: {
  expedienteId: string;
}): Promise<ValidacionResult<ExpedienteRow>> {
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
// sendToFinanceAction  (RF-DIA-044) — handoff a Andrium (impresión)
// ---------------------------------------------------------------------------

export async function sendToFinanceAction(input: {
  caseId: string;
  expedienteId: string;
}): Promise<ValidacionResult> {
  try {
    const actor = await requireActor();
    await sendToFinance(actor, {
      caseId: input.caseId,
      expedienteId: input.expedienteId,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}
