/**
 * Expediente module — domain event types and wiring.
 *
 * Events emitted:
 *   expediente.compiled     — compilation succeeded; downstream can auto-notify Diana
 *   expediente.sent_to_finance — placeholder for F6 finance flow
 *
 * Consumer registration is done at module startup via register-consumers.ts.
 * Do NOT call appEvents.on() here directly.
 *
 * @module expediente/events
 */

import { appEvents } from "@/backend/platform/events";
import type { DomainEvent } from "@/backend/platform/events";

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface ExpedienteCompiledPayload {
  caseId: string;
  expedienteId: string;
  attemptNo: number;
}

export interface ExpedienteSentToFinancePayload {
  caseId: string;
  expedienteId: string;
  attemptNo: number;
}

// Union of all events emitted by this module
export type ExpedienteEvent =
  | DomainEvent<ExpedienteCompiledPayload> & { type: "expediente.compiled" }
  | DomainEvent<ExpedienteSentToFinancePayload> & { type: "expediente.sent_to_finance" };

// ---------------------------------------------------------------------------
// Typed emitter helpers (called from service.ts)
// ---------------------------------------------------------------------------

export function emitExpedienteCompiled(payload: ExpedienteCompiledPayload): void {
  appEvents.emit({
    type: "expediente.compiled",
    payload,
    occurredAt: new Date(),
  } satisfies DomainEvent<ExpedienteCompiledPayload>);
}

export function emitExpedienteSentToFinance(payload: ExpedienteSentToFinancePayload): void {
  appEvents.emit({
    type: "expediente.sent_to_finance",
    payload,
    occurredAt: new Date(),
  } satisfies DomainEvent<ExpedienteSentToFinancePayload>);
}

// ---------------------------------------------------------------------------
// Consumer registration hook (called from register-consumers.ts)
// ---------------------------------------------------------------------------

/**
 * Registers expediente event consumers on the global event bus.
 *
 * In F5 the expediente module only EMITS events (no subscriptions).
 * This hook exists for future wiring (e.g. F6 finance notifications).
 *
 * Called from src/backend/modules/register-consumers.ts at startup.
 */
export function registerExpedienteConsumers(): void {
  // No subscriptions in F5 — expediente is driven by Diana's UI actions.
}
