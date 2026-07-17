/**
 * QStash job: run-premortem
 *
 * Asynchronous execution of the Pre-Mortem quality validator (one long Anthropic
 * call, 700s ceiling). Dispatched by ai-engine/service.ts startPreMortemValidation().
 *
 * Idempotency (single-spend discipline — see executePreMortemJob):
 *   - Atomic claim queued→running on the assessment row; a lost claim skips.
 *   - Call failure reverts to queued + throws → QStash retries (nothing was paid).
 *   - Persist failure after a successful call NEVER re-runs the call.
 *   - dedupeId = run-premortem:<assessmentId> (per-ROW — per-target would make
 *     QStash silently drop legitimate re-validations inside its dedup window).
 *
 * Retries: 2 (3 total attempts). Enqueued with timeout "780s" — QStash's 60s
 * default would fire a CONCURRENT retry mid-call. The webhook route runs with
 * maxDuration=800 so the 700s call + persist fit in one invocation.
 * On exhaustion: job-failed callback marks the assessment failed.
 *
 * Schedule: triggered on-demand (no cron).
 *
 * Boundary: imports ONLY from module-pub (ai-engine/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import {
  executePreMortemJob,
  type RunPreMortemPayload,
} from "@/backend/modules/ai-engine";

// ---------------------------------------------------------------------------
// Payload schema
// ---------------------------------------------------------------------------

const RunPreMortemPayloadSchema = z.object({
  jobKey: z.literal("run-premortem"),
  entityId: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  orgId: z.string().uuid(),
  assessmentId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles the run-premortem QStash job.
 *
 * Delegates to ai-engine/service.executePreMortemJob for all business logic.
 * Returns void; throws on retryable errors (QStash will retry).
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleRunPremortem(rawPayload: unknown): Promise<void> {
  const parseResult = RunPreMortemPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "run-premortem: invalid payload — skipping (non-retryable)",
    );
    return; // 2xx non-retryable: schema error
  }

  const payload = parseResult.data as RunPreMortemPayload;

  logger.info(
    { job: "run-premortem", assessmentId: payload.assessmentId, attempt: payload.attempt },
    "run-premortem: start",
  );

  const outcome = await executePreMortemJob(payload);

  logger.info(
    { job: "run-premortem", assessmentId: payload.assessmentId, outcome },
    "run-premortem: done",
  );
}
