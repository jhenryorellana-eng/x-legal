/**
 * QStash job: lex-answer
 *
 * Asynchronous execution of one Lex case-chat answer (embed → case-scoped
 * retrieval → single Anthropic call with web_search, ~180s ceiling).
 * Dispatched by ai-engine/lex-service.ts sendLexMessage().
 *
 * Idempotency (single-spend discipline — see executeLexAnswerJob):
 *   - A completed assistant message is a hard no-op (at-least-once delivery
 *     must never re-run a paid call).
 *   - Deterministic failures (no question, case gone, empty output, 4xx) mark
 *     the message failed WITHOUT rethrow → 2xx, no retry.
 *   - Provider/infra failures (429/5xx/network) mark failed + rethrow → QStash
 *     retries; the retry re-enters (only 'completed' skips).
 *   - dedupeId = lex-answer:<assistantMessageId> (per-ROW — each send is a new
 *     message, so the webhook barrier never blocks a legitimate question).
 *
 * Retries: 2 (3 total attempts). Enqueued with timeout "280s" — QStash's 60s
 * default would fire a CONCURRENT retry mid-call (double spend).
 *
 * Schedule: triggered on-demand (no cron).
 *
 * Boundary: imports ONLY from module-pub (ai-engine/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import {
  executeLexAnswerJob,
  type LexAnswerJobPayload,
} from "@/backend/modules/ai-engine";

// ---------------------------------------------------------------------------
// Payload schema
// ---------------------------------------------------------------------------

const LexAnswerPayloadSchema = z.object({
  jobKey: z.literal("lex-answer"),
  entityId: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  orgId: z.string().uuid(),
  messageId: z.string().uuid(),
  threadId: z.string().uuid(),
  caseId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles the lex-answer QStash job.
 *
 * Delegates to ai-engine lex-service.executeLexAnswerJob for all business logic.
 * Returns void; throws on retryable errors (QStash will retry).
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleLexAnswer(rawPayload: unknown): Promise<void> {
  const parseResult = LexAnswerPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "lex-answer: invalid payload — skipping (non-retryable)",
    );
    return; // 2xx non-retryable: schema error
  }

  const payload = parseResult.data as LexAnswerJobPayload;

  logger.info(
    { job: "lex-answer", messageId: payload.messageId, caseId: payload.caseId, attempt: payload.attempt },
    "lex-answer: start",
  );

  const outcome = await executeLexAnswerJob(payload);

  logger.info(
    { job: "lex-answer", messageId: payload.messageId, outcome },
    "lex-answer: done",
  );
}
