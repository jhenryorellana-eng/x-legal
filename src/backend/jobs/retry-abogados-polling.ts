/**
 * QStash job: retry-abogados-polling
 *
 * Cron job (every 6 hours — DOC-26 §2.8, §3) that polls SaaS Abogados for
 * verdicts that were not delivered by webhook (best-effort, single attempt).
 *
 * Universe: legal_validations with status IN ('sent','queued','in_review')
 * AND sent_at < now - 24h (uses the partial index per DOC-30 §9).
 *
 * For each candidate:
 *   1. GET /api/integration/validations/{cases.id}?source=usalatinoprime-v2
 *   2. If verdict present and not yet applied → applyVerdict (same as webhook)
 *   3. Refresh semaforo / ai_score / status mirror
 *   4. If >72h without verdict → mark error + log for human review
 *
 * Idempotency: shared with the webhook via claimWebhookEvent
 * with key '{validation_id}:{verdict_at}' (source='abogados').
 * DOC-70 §4.3, DOC-26 §2.8.
 *
 * Retries: 1 (DOC-26 §5.1 — next cron run covers the rest).
 *
 * Schedule (QStash): every-6-hours cron UTC (DOC-26 §3).
 *
 * Boundary: imports ONLY from module index.ts, platform/, and shared/
 * (rule R3 DOC-21 §1, eslint-plugin-boundaries).
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import {
  reconcileFromPolling,
  listPollingCandidates,
} from "@/backend/modules/integrations";

// ---------------------------------------------------------------------------
// Payload schema (minimal cron payload per DOC-26 §1.2)
// ---------------------------------------------------------------------------

const RetryAbogadosPollingPayloadSchema = z.object({
  jobKey: z.literal("retry-abogados-polling"),
  entityId: z.null().optional(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
});

export type RetryAbogadosPollingPayload = z.infer<
  typeof RetryAbogadosPollingPayloadSchema
>;

// ---------------------------------------------------------------------------
// Job handler
// ---------------------------------------------------------------------------

/**
 * Handles the retry-abogados-polling cron job.
 *
 * Sweeps pending legal_validations rows and reconciles with SaaS Abogados.
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleRetryAbogadosPolling(
  rawPayload: unknown,
): Promise<void> {
  const parseResult = RetryAbogadosPollingPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "retry-abogados-polling: invalid payload — skipping",
    );
    return;
  }

  logger.info(
    { job: "retry-abogados-polling" },
    "retry-abogados-polling: start",
  );

  const candidates = await listPollingCandidates();

  logger.info(
    { job: "retry-abogados-polling", count: candidates.length },
    "retry-abogados-polling: candidates found",
  );

  let processed = 0;
  let errors = 0;

  for (const row of candidates) {
    try {
      await reconcileFromPolling(row);
      processed += 1;
    } catch (err) {
      errors += 1;
      logger.error(
        {
          err: (err as Error).message,
          validationId: row.id,
          caseId: row.case_id,
        },
        "retry-abogados-polling: reconcileFromPolling threw — continuing",
      );
    }
  }

  logger.info(
    { job: "retry-abogados-polling", processed, errors, total: candidates.length },
    "retry-abogados-polling: end",
  );
}
