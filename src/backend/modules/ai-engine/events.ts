/**
 * ai-engine module — domain event types and wiring.
 *
 * Events emitted (DOC-42 §5.1):
 *   generation.completed  — when executeGenerationJob finalizes successfully
 *   generation.failed     — on non-retryable error or job-failed callback
 *   extraction.completed  — when executeExtractionJob completes upsert
 *
 * Consumers:
 *   notifications  — alerts to requested_by + admin
 *   audit/timeline — case timeline entry for generation.completed
 *   kanban         — badge refresh on generation.completed / generation.failed
 *
 * This module does NOT subscribe to any events (DOC-42 §5.2).
 *
 * @module ai-engine/events
 */

import { appEvents } from "@/backend/platform/events";
import type { DomainEvent } from "@/backend/platform/events";

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface GenerationCompletedPayload {
  caseId: string;
  runId: string;
  formDefinitionId: string;
  partyId: string | null;
  version: number;
  isTest: boolean;
}

export interface GenerationFailedPayload {
  caseId: string;
  runId: string;
  formDefinitionId: string;
  partyId: string | null;
  version: number;
  error: string;
  isTest: boolean;
}

export interface ExtractionCompletedPayload {
  caseId: string;
  caseDocumentId: string;
}

// ---------------------------------------------------------------------------
// Typed event emitter helpers
// ---------------------------------------------------------------------------

export function emitGenerationCompleted(
  payload: GenerationCompletedPayload,
): void {
  appEvents.emit({
    type: "generation.completed",
    payload,
    occurredAt: new Date(),
  } satisfies DomainEvent<GenerationCompletedPayload>);
}

export function emitGenerationFailed(payload: GenerationFailedPayload): void {
  appEvents.emit({
    type: "generation.failed",
    payload,
    occurredAt: new Date(),
  } satisfies DomainEvent<GenerationFailedPayload>);
}

export function emitExtractionCompleted(
  payload: ExtractionCompletedPayload,
): void {
  appEvents.emit({
    type: "extraction.completed",
    payload,
    occurredAt: new Date(),
  } satisfies DomainEvent<ExtractionCompletedPayload>);
}

// ---------------------------------------------------------------------------
// Consumer registration (called from register-consumers.ts)
// ---------------------------------------------------------------------------

/**
 * Registers ai-engine event consumers on the global event bus.
 *
 * Currently a no-op: ai-engine does not subscribe to other modules' events
 * (DOC-42 §5.2). This function exists as a hook for future wiring.
 *
 * Called from src/backend/register-consumers.ts at startup.
 */
export function registerAiEngineConsumers(): void {
  // No subscriptions in V2.0 — ai-engine is driven by QStash jobs and UI actions
}
