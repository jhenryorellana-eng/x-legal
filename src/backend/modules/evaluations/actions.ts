/**
 * Evaluations module server actions — public API surface (module-pub boundary).
 *
 * Each action:
 * 1. Calls requireActor() to build the Actor.
 * 2. Delegates to service.ts (authorization happens there).
 * 3. Returns a typed ActionResult.
 *
 * Note: "use server" directive belongs in Next.js action files under src/app/.
 * These functions are the service layer exposed as module-pub; Next.js wrappers
 * in src/app/ call these directly.
 */

import { requireActor, AuthzError } from "@/backend/platform/authz";
import { EvaluationsError } from "./domain";
import * as svc from "./service";

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

function fail(err: unknown): ActionResult<never> {
  if (err instanceof EvaluationsError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof AuthzError) {
    return { success: false, error: { code: err.reason, message: err.reason } };
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  return { success: false, error: { code: "INTERNAL_ERROR", message } };
}

/** Client screen refresh/poll (also creates the session lazily on first call). */
export async function getClientEvaluationStateAction(
  caseId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof svc.getOrCreateClientEvaluation>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.getOrCreateClientEvaluation(actor, caseId));
  } catch (e) {
    return fail(e);
  }
}

/** Signed URL of the delivered PDF (client). */
export async function getClientEvaluationPdfUrlAction(
  caseId: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const actor = await requireActor();
    return ok({ url: await svc.getClientEvaluationPdfUrl(actor, caseId) });
  } catch (e) {
    return fail(e);
  }
}

/** Admin-only: +1 attempt for the case's evaluation session. */
export async function grantExtraAttemptAction(
  caseId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof svc.grantExtraAttempt>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.grantExtraAttempt(actor, caseId));
  } catch (e) {
    return fail(e);
  }
}

/** Signed URL of the delivered PDF (staff tab). */
export async function getStaffEvaluationPdfUrlAction(
  caseId: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const actor = await requireActor();
    return ok({ url: await svc.getStaffEvaluationPdfUrl(actor, caseId) });
  } catch (e) {
    return fail(e);
  }
}
