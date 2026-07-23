/**
 * QStash job: reconcile-juez-evaluations
 *
 * Cron job that polls the external tool Juez for evaluations stuck
 * `in_progress` (>15 min without a webhook). Backstop for the inbound
 * webhook /api/webhooks/juez (contract v1 §3.4 — docs/PROMPT-JUEZ-XLEGAL.md).
 *
 * For each stale session: GET {base_url}/api/xlegal/status?jobId= with the
 * shared x-api-key; done → applyEvaluationCompleted, error →
 * applyEvaluationFailed — the SAME handlers as the webhook, so the
 * webhook_events key ({jobId}:{event}) dedupes naturally when both arrive.
 *
 * Retries: 1 (next cron run covers the rest).
 * Schedule (QStash): every-15-min cron UTC (cheap: indexed partial scan,
 * ≤20 rows per run, no-op when nothing is stale).
 *
 * Boundary: imports ONLY from module index.ts, platform/, and shared/
 * (rule R3 DOC-21 §1, eslint-plugin-boundaries).
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { reconcileStaleEvaluations } from "@/backend/modules/evaluations";

// ---------------------------------------------------------------------------
// Payload schema (minimal cron payload per DOC-26 §1.2)
// ---------------------------------------------------------------------------

const ReconcileJuezEvaluationsPayloadSchema = z.object({
  jobKey: z.literal("reconcile-juez-evaluations"),
  entityId: z.null().optional(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
});

export type ReconcileJuezEvaluationsPayload = z.infer<
  typeof ReconcileJuezEvaluationsPayloadSchema
>;

// ---------------------------------------------------------------------------
// Job handler
// ---------------------------------------------------------------------------

/**
 * Handles the reconcile-juez-evaluations cron job.
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleReconcileJuezEvaluations(
  rawPayload: unknown,
): Promise<void> {
  const parseResult = ReconcileJuezEvaluationsPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "reconcile-juez-evaluations: invalid payload — skipping",
    );
    return;
  }

  logger.info({ job: "reconcile-juez-evaluations" }, "reconcile-juez-evaluations: start");

  try {
    await reconcileStaleEvaluations();
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      "reconcile-juez-evaluations: sweep threw — next cron run retries",
    );
  }

  logger.info({ job: "reconcile-juez-evaluations" }, "reconcile-juez-evaluations: end");
}
