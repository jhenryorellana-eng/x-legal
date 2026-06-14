/**
 * QStash job: job-failed
 *
 * Failure callback handler invoked by QStash when a job exhausts its retries.
 * (DOC-26 §5.2 — failure callback pattern)
 *
 * Receives the original job payload + error. Resolves jobKey/entityId and:
 *   1. Marks the entity in terminal failure state
 *   2. Emits the appropriate failure event (for notifications)
 *   3. Logs with outcome='exhausted'
 *
 * This handler returns 2xx always (throwing here would cause QStash to retry
 * the callback itself, creating an infinite loop).
 *
 * Boundary: imports ONLY from module-pub (ai-engine/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import {
  markRunFailedByCallback,
  markExtractionFailed,
  markTranslationFailed,
} from "@/backend/modules/ai-engine";

// ---------------------------------------------------------------------------
// Payload schema — QStash delivers the ORIGINAL job payload to the failure URL
// ---------------------------------------------------------------------------

const JobFailedPayloadSchema = z.object({
  jobKey: z.string(),
  entityId: z.string().nullable().optional(),
  // Job-specific fields we may need
  runId: z.string().uuid().optional(),
  caseDocumentId: z.string().uuid().optional(),
  translationId: z.string().uuid().optional(),
}).passthrough(); // pass-through: we only read known fields

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles the job-failed QStash failure callback.
 *
 * Called when a job has exhausted all retries. Marks the relevant entity
 * as failed and triggers failure events/notifications.
 *
 * NEVER throws — a thrown error here would cause QStash to retry the callback.
 */
export async function handleJobFailed(rawPayload: unknown): Promise<void> {
  let parsed: z.infer<typeof JobFailedPayloadSchema> | null = null;

  try {
    const result = JobFailedPayloadSchema.safeParse(rawPayload);
    if (!result.success) {
      logger.error(
        { rawPayload, issues: result.error.issues },
        "job-failed: could not parse failure callback payload",
      );
      return;
    }
    parsed = result.data;
  } catch (err) {
    logger.error({ err, rawPayload }, "job-failed: unexpected error parsing payload");
    return;
  }

  const { jobKey, entityId } = parsed;
  const errorMsg = `job.${jobKey}: exhausted all QStash retries`;

  logger.error(
    { jobKey, entityId, outcome: "exhausted" },
    "job-failed: job exhausted retries — marking entity failed",
  );

  try {
    switch (jobKey) {
      case "run-generation": {
        const runId = parsed.runId ?? entityId ?? "";
        if (runId) {
          await markRunFailedByCallback(runId, errorMsg);
        }
        break;
      }

      case "extract-document": {
        const caseDocumentId = parsed.caseDocumentId ?? entityId ?? "";
        if (caseDocumentId) {
          await markExtractionFailed(caseDocumentId, errorMsg);
        }
        break;
      }

      case "translate-document": {
        const translationId = parsed.translationId ?? entityId ?? "";
        if (translationId) {
          await markTranslationFailed(translationId, errorMsg);
        }
        break;
      }

      default:
        // Other jobs (compile-expediente, send-campaign, etc.) handle their own failures
        logger.warn(
          { jobKey },
          "job-failed: no failure handler registered for this jobKey",
        );
    }
  } catch (err) {
    // Non-fatal: log but never throw (would loop callback retries)
    logger.error({ err, jobKey, entityId }, "job-failed: error while marking entity failed");
  }
}
