/**
 * Evaluations module — domain event types and emitters.
 *
 * Events emitted:
 *   evaluation.completed — PDF stored in x-legal (client + sales notified)
 *   evaluation.failed    — generation failed on Juez (sales notified)
 *
 * Both emits happen inside a webhook/route request, so they use emitAndWait
 * (Vercel freezes the Lambda after the response — fire-and-forget consumers
 * would silently drop their inserts, see platform/events.ts).
 *
 * Consumer registration is done at module startup via register-consumers.ts.
 *
 * @module evaluations/events
 */

import { appEvents } from "@/backend/platform/events";
import type { DomainEvent } from "@/backend/platform/events";

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface EvaluationCompletedPayload {
  caseId: string;
  orgId: string;
  evaluationId: string;
  jobId: string;
  score: number | null;
}

export interface EvaluationFailedPayload {
  caseId: string;
  orgId: string;
  evaluationId: string;
  jobId: string;
  error: string;
}

export type EvaluationsEvent =
  | (DomainEvent<EvaluationCompletedPayload> & { type: "evaluation.completed" })
  | (DomainEvent<EvaluationFailedPayload> & { type: "evaluation.failed" });

// ---------------------------------------------------------------------------
// Typed emitter helpers (called from service.ts)
// ---------------------------------------------------------------------------

export async function emitEvaluationCompleted(
  payload: EvaluationCompletedPayload,
): Promise<void> {
  await appEvents.emitAndWait({
    type: "evaluation.completed",
    payload,
    occurredAt: new Date(),
  } satisfies DomainEvent<EvaluationCompletedPayload>);
}

export async function emitEvaluationFailed(
  payload: EvaluationFailedPayload,
): Promise<void> {
  await appEvents.emitAndWait({
    type: "evaluation.failed",
    payload,
    occurredAt: new Date(),
  } satisfies DomainEvent<EvaluationFailedPayload>);
}
