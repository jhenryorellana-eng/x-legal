/**
 * QStash job: rerender-run
 *
 * Re-renders a COMPLETED generation run's PDF from its stored `output_text`
 * WITHOUT calling the model — re-resolving only the deterministic, code-owned
 * tokens (OCC address, appellant address, signature, service method, date)
 * against the case's CURRENT confirmed answers/extractions.
 *
 * Use when a deterministic INPUT changed after generation (e.g. a corrected OCC
 * service address, or an apartment removed from the source extraction) and the
 * reviewed prose must stay byte-identical. Cheap and side-effect-light: it does
 * NOT touch run status, cost, events, or version.
 *
 * Schedule: on-demand (no cron). Idempotent: overwrites the same storage object
 * `output_path` already references.
 *
 * Boundary: imports ONLY from module-pub (ai-engine/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { reRenderRun } from "@/backend/modules/ai-engine";

const RerenderRunPayloadSchema = z.object({
  jobKey: z.literal("rerender-run"),
  entityId: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  runId: z.string().uuid(),
});

/**
 * Handles the rerender-run QStash job. Delegates to ai-engine.reRenderRun.
 * Returns void; throws on retryable errors (QStash will retry).
 */
export async function handleRerenderRun(rawPayload: unknown): Promise<void> {
  const parseResult = RerenderRunPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "rerender-run: invalid payload — skipping (non-retryable)",
    );
    return; // 2xx non-retryable: schema error
  }

  const { runId } = parseResult.data;

  logger.info({ job: "rerender-run", runId }, "rerender-run: start");

  const outputPath = await reRenderRun(runId);

  logger.info({ job: "rerender-run", runId, outputPath }, "rerender-run: done");
}
