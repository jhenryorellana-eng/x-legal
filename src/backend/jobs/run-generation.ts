/**
 * QStash job: run-generation
 *
 * Asynchronous execution of T1 legal document generation (Claude).
 * Dispatched by ai-engine/service.ts startGeneration().
 *
 * DOC-26 §2.1 — payload, chunking, idempotence, retries=2.
 * DOC-42 §3.2 — executeGenerationJob (the bulk of the logic lives there).
 *
 * Idempotency:
 *   - Guard on run.status (queued/running only)
 *   - Concurrency gate (max 2 per org): defers with a 60s delay
 *   - Check cancelled before writing output
 *   - dedupeId = run-generation:<runId>:v<version>
 *
 * Retries: 2 (DOC-26 §5.1 — expensive; 3 total attempts).
 * On exhaustion: job-failed callback marks run.status='failed' + emits event.
 *
 * Schedule: triggered on-demand (no cron).
 *
 * Boundary: imports ONLY from module-pub (ai-engine/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import {
  executeGenerationJob,
  type RunGenerationPayload,
} from "@/backend/modules/ai-engine";

// ---------------------------------------------------------------------------
// Payload schema (DOC-26 §1.2)
// ---------------------------------------------------------------------------

const RunGenerationPayloadSchema = z.object({
  jobKey: z.literal("run-generation"),
  entityId: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  runId: z.string().uuid(),
  chunk: z
    .object({
      index: z.number().int().nonnegative(),
      partPaths: z.array(z.string()),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles the run-generation QStash job.
 *
 * Delegates to ai-engine/service.executeGenerationJob for all business logic.
 * Returns void; throws on retryable errors (QStash will retry).
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleRunGeneration(rawPayload: unknown): Promise<void> {
  const parseResult = RunGenerationPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "run-generation: invalid payload — skipping (non-retryable)",
    );
    return; // 2xx non-retryable: schema error
  }

  const payload = parseResult.data as RunGenerationPayload;

  logger.info(
    { job: "run-generation", runId: payload.runId, attempt: payload.attempt },
    "run-generation: start",
  );

  const outcome = await executeGenerationJob(payload);

  logger.info(
    { job: "run-generation", runId: payload.runId, outcome },
    "run-generation: done",
  );
}
