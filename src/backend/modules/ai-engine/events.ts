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
 * Lex case chat subscriptions (registerAiEngineConsumers): case knowledge
 * reindex triggers — document.uploaded / document.deleted / form_response.submitted
 * each enqueue a lex-reindex-case QStash job (the heavy work never runs inline,
 * DOC-20 §5). The reindex is incremental + idempotent (content-hash diff), and
 * its orphan sweep is what removes a deleted document's chunks.
 *
 * @module ai-engine/events
 */

import { appEvents } from "@/backend/platform/events";
import type { DomainEvent } from "@/backend/platform/events";
import { enqueueJob } from "@/backend/platform/qstash";
import { logger } from "@/backend/platform/logger";

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

export interface CoverageDetectedPayload {
  caseId: string;
  /** Source document (the combined upload) whose text covered other types. */
  caseDocumentId: string;
  /** required_document_types ids detected in this run (dismissed ones included). */
  coveredRequirementIds: string[];
}

// ---------------------------------------------------------------------------
// Typed event emitter helpers
// ---------------------------------------------------------------------------

/**
 * Emitted from finalizeRun, which runs inside a Vercel QStash invocation that is
 * FROZEN the instant it returns 200. A fire-and-forget `emit` here dropped the
 * consumer's in-flight work: exhibit capture (`captureFromRun` — case_exhibits insert
 * + fetch-exhibit enqueue) silently never persisted, so annexes never attached in prod
 * even though the pipeline works when driven synchronously. `emitAndWait` keeps that
 * light work (insert + enqueue) on the invocation's critical path; the heavy renders
 * still run in their own fetch-exhibit jobs. Any future generation.completed consumer
 * (notifications/timeline/kanban) inherits the same guarantee. Callers MUST await.
 */
export async function emitGenerationCompleted(
  payload: GenerationCompletedPayload,
): Promise<void> {
  await appEvents.emitAndWait({
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

/**
 * emitAndWait — same rationale as emitGenerationCompleted above: the extraction
 * job runs inside a Vercel QStash invocation that is FROZEN the instant it
 * returns 200. The ai_field prefill warm consumer (register-consumers →
 * enqueueAiPrefillWarm) does an async QStash publish; a fire-and-forget `emit`
 * dropped that in-flight enqueue in prod (cache stayed cold — found live
 * 2026-07-18, exact repeat of the exhibits-capture lesson). Callers MUST await.
 */
export async function emitExtractionCompleted(
  payload: ExtractionCompletedPayload,
): Promise<void> {
  await appEvents.emitAndWait({
    type: "extraction.completed",
    payload,
    occurredAt: new Date(),
  } satisfies DomainEvent<ExtractionCompletedPayload>);
}

/**
 * emitAndWait — same frozen-invocation rationale as emitExtractionCompleted:
 * consumers do async QStash publishes (prefill warm) and DB writes (timeline,
 * questionnaire bootstrap) that a fire-and-forget emit would drop the instant
 * the coverage job returns 200. Callers MUST await.
 */
export async function emitCoverageDetected(
  payload: CoverageDetectedPayload,
): Promise<void> {
  await appEvents.emitAndWait({
    type: "document.coverage_detected",
    payload,
    occurredAt: new Date(),
  } satisfies DomainEvent<CoverageDetectedPayload>);
}

// ---------------------------------------------------------------------------
// Consumer registration (called from register-consumers.ts)
// ---------------------------------------------------------------------------

/**
 * Enqueues a lex-reindex-case job for the case knowledge index.
 *
 * orgId is DELIBERATELY omitted: the webhook's idempotency barrier is permanent
 * per (source, dedupeId), so an org-scoped `lex-reindex:<case>:1` would process
 * only the FIRST event of that case ever and silently drop every later
 * upload/delete/submit. Without orgId the route dispatches directly; QStash's
 * own publish-dedup still coalesces bursts (same dedupeId within its window),
 * and the job itself is idempotent (content-hash diff + orphan sweep).
 * Non-fatal by contract: a lost trigger only delays the index.
 *
 * Exported for the day-zero bootstrap in lex-service.getLexThread (cases that
 * predate Lex have no chunks and no future event may ever fire for them).
 */
export async function enqueueLexReindex(caseId: string): Promise<void> {
  try {
    await enqueueJob(
      {
        jobKey: "lex-reindex-case",
        entityId: caseId,
        attempt: 1,
        dedupeId: `lex-reindex:${caseId}:1`,
        caseId,
      },
      { retries: 2, timeout: "280s" },
    );
  } catch (err) {
    logger.warn({ err, caseId }, "ai-engine: failed to enqueue lex-reindex-case (non-fatal)");
  }
}

/**
 * Enqueues a classify-document-coverage job for a source document whose primary
 * extraction just completed. The nonce (caller passes a fresh value per firing)
 * keeps the dedupeId unique across re-extractions — the webhook's idempotency
 * barrier is permanent per (source, dedupeId), so a fixed id would classify only
 * the FIRST extraction of that document ever (same lesson as enqueueLexReindex).
 * Non-fatal by contract: a lost trigger only means "no coverage yet".
 */
export async function enqueueCoverageClassification(
  caseDocumentId: string,
  nonce: string,
): Promise<void> {
  try {
    await enqueueJob(
      {
        jobKey: "classify-document-coverage",
        entityId: caseDocumentId,
        attempt: 1,
        dedupeId: `classify-coverage:${caseDocumentId}:${nonce}`,
        caseDocumentId,
      },
      { retries: 2, timeout: "280s" },
    );
  } catch (err) {
    logger.warn(
      { err, caseDocumentId },
      "ai-engine: failed to enqueue classify-document-coverage (non-fatal)",
    );
  }
}

/**
 * Registers ai-engine event consumers on the global event bus.
 *
 * Lex case chat: keep the per-case knowledge index fresh when the evidence
 * changes — a client (or staff) document upload/delete, or a submitted form
 * response. Each consumer is fault-isolated (enqueueLexReindex never throws;
 * the bus also isolates consumers from each other).
 *
 * Coverage: every completed primary extraction chains the combined-upload
 * classification (both the single-call and chunked routes emit the same event,
 * so one hook covers both).
 *
 * Called from src/backend/modules/register-consumers.ts at startup.
 */
export function registerAiEngineConsumers(): void {
  appEvents.on("document.uploaded", async (event) => {
    const p = (event.payload ?? {}) as { caseId?: string; documentId?: string };
    if (!p.caseId) return;
    await enqueueLexReindex(p.caseId);
  });

  appEvents.on("extraction.completed", async (event) => {
    const p = (event.payload ?? {}) as { caseId?: string; caseDocumentId?: string };
    if (!p.caseDocumentId) return;
    await enqueueCoverageClassification(p.caseDocumentId, String(Date.now()));
  });

  appEvents.on("document.deleted", async (event) => {
    const p = (event.payload ?? {}) as { caseId?: string; documentId?: string };
    if (!p.caseId) return;
    // The reindex's orphan sweep (deleteChunksNotIn) removes this document's chunks.
    await enqueueLexReindex(p.caseId);
  });

  appEvents.on("form_response.submitted", async (event) => {
    const p = (event.payload ?? {}) as { caseId?: string; responseId?: string };
    if (!p.caseId) return;
    await enqueueLexReindex(p.caseId);
  });
}
