"use server";

/**
 * AI-letter generation server actions (Ola 2 — Generaciones review).
 *
 * Powers the "Ver / Generar / Revisar" buttons on the Generaciones tab and the
 * letter split-screen: view the generated letter PDF, (re)generate a new version
 * (async), and poll the run status until it completes. Boundary R1/R2: app →
 * ai-engine module-pub only.
 */

import { requireActor } from "@/backend/modules/identity";
import {
  startGeneration,
  getGenerationOutputUrl,
  getRunStatus,
  AiEngineError,
} from "@/backend/modules/ai-engine";
import { getCompiledPdfUrl, ExpedienteError } from "@/backend/modules/expediente";

/** Short-lived signed URL of an expediente attempt's compiled PDF ("Ver expediente"). */
export async function getExpedientePdfUrlAction(input: {
  expedienteId: string;
}): Promise<{ ok: boolean; data?: string; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const url = await getCompiledPdfUrl(actor, input.expedienteId);
    return { ok: true, data: url };
  } catch (err) {
    if (err instanceof ExpedienteError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

/** Short-lived signed URL of a run's generated letter (null when not generated). */
export async function getGenerationOutputUrlAction(input: {
  runId: string;
}): Promise<{ ok: boolean; url?: string | null; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const url = await getGenerationOutputUrl(actor, input.runId);
    return { ok: true, url };
  } catch (err) {
    if (err instanceof AiEngineError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

/**
 * (Re)generate the AI letter as a NEW version (async QStash job). Same params as
 * the current run; the AI_RUN_DUPLICATE guard means "one is already in flight".
 */
export async function startLetterGenerationAction(input: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
}): Promise<{ ok: boolean; runId?: string; budgetWarning?: string | null; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const res = await startGeneration(actor, {
      caseId: input.caseId,
      formDefinitionId: input.formDefinitionId,
      partyId: input.partyId ?? null,
    });
    return { ok: true, runId: res.run.id, budgetWarning: res.budgetWarning };
  } catch (err) {
    if (err instanceof AiEngineError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

/** Poll a run's status (for the "Generando…" state after a regeneration). */
export async function getRunStatusAction(input: {
  runId: string;
}): Promise<{ ok: boolean; status?: string; outputAvailable?: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    const r = await getRunStatus(actor, input.runId);
    return { ok: true, status: r.status, outputAvailable: r.outputAvailable };
  } catch (err) {
    if (err instanceof AiEngineError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}
