/**
 * QStash job: fetch-exhibit
 *
 * Downloads/renders ONE cited source to PDF and binds it as an exhibit. Fanned out
 * (one message per exhibit) by exhibits.captureFromRun on `generation.completed`.
 *
 * Idempotency:
 *   - Conditional claim (status pending|fetching|failed → fetching, attempts+1)
 *   - Re-delivery after 'ready' is a no-op (outcome='skipped')
 *   - dedupeId = fetch-exhibit:<exhibitId>:a<attempt>
 *
 * Retries: 2 (3 deliveries). The handler marks 'failed' on the last delivery
 * (2xx, no DLQ); transient errors before the cap rethrow so QStash retries.
 *
 * Boundary: imports ONLY from module-pub (exhibits/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { executeFetchExhibitJob } from "@/backend/modules/exhibits";

const FetchExhibitPayloadSchema = z.object({
  jobKey: z.literal("fetch-exhibit"),
  entityId: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  exhibitId: z.string().uuid(),
  orgId: z.string().uuid().optional(),
});

export async function handleFetchExhibit(rawPayload: unknown): Promise<void> {
  const parsed = FetchExhibitPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues }, "fetch-exhibit: invalid payload — skipping (non-retryable)");
    return; // 2xx non-retryable: schema error
  }

  const outcome = await executeFetchExhibitJob({ exhibitId: parsed.data.exhibitId });
  logger.info({ job: "fetch-exhibit", exhibitId: parsed.data.exhibitId, outcome }, "fetch-exhibit: done");
}
