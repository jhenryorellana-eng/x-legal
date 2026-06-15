/**
 * Integrations module — domain event types and emitters.
 *
 * Events emitted:
 *   validation.sent           — expediente sent to lawyer (POST 202/200-dedup)
 *   validation.verdict_received — lawyer verdict applied (validated/needs_corrections)
 *
 * Consumer registration is done at module startup via register-consumers.ts.
 * Do NOT call appEvents.on() here directly.
 *
 * @module integrations/events
 */

import { appEvents } from "@/backend/platform/events";
import type { DomainEvent } from "@/backend/platform/events";

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface ValidationSentPayload {
  caseId: string;
  expedienteId: string;
  validationId: string;
  externalValidationId: string;
  attemptNo: number;
  semaforo: string | null;
}

export interface ValidationVerdictReceivedPayload {
  caseId: string;
  expedienteId: string;
  validationId: string;
  externalValidationId: string;
  attemptNo: number;
  verdict: "validated" | "needs_corrections" | "cancelled";
  verdictNotes: string | null;
  returnTo: string | null;
  semaforo: string | null;
  aiScore: number | null;
}

// Union of all events emitted by this module
export type IntegrationsEvent =
  | DomainEvent<ValidationSentPayload> & { type: "validation.sent" }
  | DomainEvent<ValidationVerdictReceivedPayload> & { type: "validation.verdict_received" };

// ---------------------------------------------------------------------------
// Typed emitter helpers (called from service.ts)
// ---------------------------------------------------------------------------

export function emitValidationSent(payload: ValidationSentPayload): void {
  appEvents.emit({
    type: "validation.sent",
    payload,
    occurredAt: new Date(),
  } satisfies DomainEvent<ValidationSentPayload>);
}

export function emitVerdictReceived(
  payload: ValidationVerdictReceivedPayload,
): void {
  appEvents.emit({
    type: "validation.verdict_received",
    payload,
    occurredAt: new Date(),
  } satisfies DomainEvent<ValidationVerdictReceivedPayload>);
}

// ---------------------------------------------------------------------------
// Consumer registration hook (called from register-consumers.ts)
// ---------------------------------------------------------------------------

/**
 * Registers integrations event consumers on the global event bus.
 *
 * F6: notifications module will subscribe to validation.sent and
 * validation.verdict_received to trigger Diana/client notifications.
 *
 * Called from src/backend/modules/register-consumers.ts at startup.
 */
export function registerIntegrationsConsumers(): void {
  // Subscriptions wired in F6 (notifications matrix).
}
