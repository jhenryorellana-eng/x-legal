/**
 * QStash job: classify-document-coverage
 *
 * Combined-upload coverage: after a document's primary extraction completes,
 * classify its raw_text against the phase's detectable sibling types and
 * persist coverage rows ("this upload contains that type's content").
 * Chained from the extraction.completed event (ai-engine/events.ts).
 *
 * Idempotency:
 *   - dedupeId = classify-coverage:<case_document_id>:<nonce> (nonce keeps
 *     re-extractions re-classifiable — the webhook barrier is permanent)
 *   - staff dismissals are sticky (never resurrected by re-runs)
 *
 * Retries: 2. Fail-open by contract: a failed classification never affects
 * the primary extraction nor blocks the client.
 *
 * Boundary: imports ONLY from module-pub (ai-engine/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import {
  executeCoverageClassificationJob,
  type ClassifyCoveragePayload,
} from "@/backend/modules/ai-engine";

// ---------------------------------------------------------------------------
// Payload schema
// ---------------------------------------------------------------------------

// NOTE: ids validated as non-empty strings, not z.string().uuid() — demo seeds
// use non-RFC UUIDs (00000000-…-003xx) that Zod v4 rejects but Postgres accepts.
const ClassifyCoveragePayloadSchema = z.object({
  jobKey: z.literal("classify-document-coverage"),
  entityId: z.string().min(1),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  caseDocumentId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles the classify-document-coverage QStash job.
 *
 * Delegates to ai-engine/service.executeCoverageClassificationJob.
 * Throws on retryable errors (QStash retries up to 2 times).
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleClassifyDocumentCoverage(
  rawPayload: unknown,
): Promise<void> {
  const parseResult = ClassifyCoveragePayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "classify-document-coverage: invalid payload — skipping (non-retryable)",
    );
    return;
  }

  const payload = parseResult.data as ClassifyCoveragePayload;

  logger.info(
    {
      job: "classify-document-coverage",
      caseDocumentId: payload.caseDocumentId,
      attempt: payload.attempt,
    },
    "classify-document-coverage: start",
  );

  const outcome = await executeCoverageClassificationJob(payload);

  logger.info(
    {
      job: "classify-document-coverage",
      caseDocumentId: payload.caseDocumentId,
      outcome,
    },
    "classify-document-coverage: done",
  );
}
