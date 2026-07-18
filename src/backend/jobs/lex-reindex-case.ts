/**
 * QStash job: lex-reindex-case
 *
 * Incremental reindex of a case's Lex knowledge chunks (case profile +
 * document extractions + form responses), content-hash gated — only
 * new/changed chunks are (re-)embedded; orphans are swept. Dispatched by the
 * ai-engine event consumers (document.uploaded / document.deleted /
 * form_response.submitted) and self re-enqueued with a 30s delay while
 * ai_extract documents still lack a completed extraction.
 *
 * Idempotency: the job is internally idempotent (re-running only re-diffs).
 * orgId is OPTIONAL in the envelope: event-driven enqueues omit it on purpose
 * so the webhook's permanent dedupe barrier cannot swallow future triggers of
 * the same case (see ai-engine/events.ts enqueueLexReindex).
 *
 * Retries: 2 (3 total attempts). Enqueued with timeout "280s" (embedding many
 * changed chunks can take a while) — QStash's 60s default would fire a
 * concurrent retry mid-run.
 *
 * Schedule: triggered on-demand (no cron).
 *
 * Boundary: imports ONLY from module-pub (ai-engine/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import {
  executeLexReindexJob,
  type LexReindexJobPayload,
} from "@/backend/modules/ai-engine";

// ---------------------------------------------------------------------------
// Payload schema
// ---------------------------------------------------------------------------

const LexReindexPayloadSchema = z.object({
  jobKey: z.literal("lex-reindex-case"),
  entityId: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  // Optional by design (see header): without orgId the route skips the
  // permanent webhook-events barrier and dispatches directly.
  orgId: z.string().uuid().optional(),
  caseId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles the lex-reindex-case QStash job.
 *
 * Delegates to ai-engine lex-service.executeLexReindexJob for all business
 * logic. Returns void; throws on retryable errors (QStash will retry).
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleLexReindexCase(rawPayload: unknown): Promise<void> {
  const parseResult = LexReindexPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "lex-reindex-case: invalid payload — skipping (non-retryable)",
    );
    return; // 2xx non-retryable: schema error
  }

  const payload = parseResult.data as LexReindexJobPayload;

  logger.info(
    { job: "lex-reindex-case", caseId: payload.caseId, attempt: payload.attempt },
    "lex-reindex-case: start",
  );

  const outcome = await executeLexReindexJob(payload);

  logger.info(
    { job: "lex-reindex-case", caseId: payload.caseId, outcome },
    "lex-reindex-case: done",
  );
}
