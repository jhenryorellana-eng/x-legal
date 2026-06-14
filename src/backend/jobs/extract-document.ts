/**
 * QStash job: extract-document
 *
 * Asynchronous extraction of structured data from a case document via Gemini.
 * Dispatched by cases/service.ts confirmDocumentUpload() when ai_extract=true.
 *
 * DOC-26 §2.2 — idempotence, retries=3.
 * DOC-42 §3.6 — executeExtractionJob (bulk of logic lives there).
 *
 * Idempotency:
 *   - UNIQUE(case_document_id) upsert — skip if already completed
 *   - dedupeId = extract-document:<case_document_id>
 *
 * Retries: 3 (DOC-26 §5.1 — cheap Gemini calls; 4 total attempts).
 * On exhaustion: job-failed callback marks extraction.status='failed'.
 *
 * Schedule: triggered on-demand (no cron).
 *
 * Boundary: imports ONLY from module-pub (ai-engine/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import {
  executeExtractionJob,
  type ExtractDocumentPayload,
} from "@/backend/modules/ai-engine";

// ---------------------------------------------------------------------------
// Payload schema (DOC-26 §1.2)
// ---------------------------------------------------------------------------

const ExtractDocumentPayloadSchema = z.object({
  jobKey: z.literal("extract-document"),
  entityId: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  caseDocumentId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles the extract-document QStash job.
 *
 * Delegates to ai-engine/service.executeExtractionJob for all business logic.
 * Throws on retryable errors (QStash will retry up to 3 times).
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleExtractDocument(rawPayload: unknown): Promise<void> {
  const parseResult = ExtractDocumentPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "extract-document: invalid payload — skipping (non-retryable)",
    );
    return;
  }

  const payload = parseResult.data as ExtractDocumentPayload;

  logger.info(
    {
      job: "extract-document",
      caseDocumentId: payload.caseDocumentId,
      attempt: payload.attempt,
    },
    "extract-document: start",
  );

  const outcome = await executeExtractionJob(payload);

  logger.info(
    { job: "extract-document", caseDocumentId: payload.caseDocumentId, outcome },
    "extract-document: done",
  );
}
