/**
 * QStash job: translate-document
 *
 * Asynchronous translation of a case document (ES↔EN) via Gemini.
 * Dispatched by ai-engine/service.ts translateDocument().
 *
 * DOC-26 §2.3 — idempotence, retries=3.
 * DOC-42 §3.7 — executeTranslationJob (bulk of logic lives there).
 *
 * Idempotency:
 *   - status check: skip if translation.status='completed'
 *   - dedupeId = translate-document:<case_document_id>:<direction>
 *
 * Retries: 3 (DOC-26 §5.1).
 * On exhaustion: job-failed callback marks translation.status='failed'.
 *
 * Schedule: triggered on-demand (no cron).
 *
 * Boundary: imports ONLY from module-pub (ai-engine/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import {
  executeTranslationJob,
  type TranslateDocumentJobPayload,
} from "@/backend/modules/ai-engine";

// ---------------------------------------------------------------------------
// Payload schema (DOC-26 §1.2)
// ---------------------------------------------------------------------------

const TranslateDocumentPayloadSchema = z.object({
  jobKey: z.literal("translate-document"),
  entityId: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  translationId: z.string().uuid(),
  direction: z.enum(["es-en", "en-es"]),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles the translate-document QStash job.
 *
 * Delegates to ai-engine/service.executeTranslationJob for all business logic.
 * Throws on retryable errors (QStash will retry up to 3 times).
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleTranslateDocument(rawPayload: unknown): Promise<void> {
  const parseResult = TranslateDocumentPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "translate-document: invalid payload — skipping (non-retryable)",
    );
    return;
  }

  const payload = parseResult.data as TranslateDocumentJobPayload;

  logger.info(
    {
      job: "translate-document",
      translationId: payload.translationId,
      direction: payload.direction,
      attempt: payload.attempt,
    },
    "translate-document: start",
  );

  const outcome = await executeTranslationJob(payload);

  logger.info(
    {
      job: "translate-document",
      translationId: payload.translationId,
      outcome,
    },
    "translate-document: done",
  );
}
