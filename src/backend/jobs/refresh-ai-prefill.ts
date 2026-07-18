/**
 * QStash job: refresh-ai-prefill
 *
 * Warms the `case_ai_field_cache` for a case: resolves EVERY `ai_field`
 * question of the case's current phase in one batched pass (grouped by
 * connected source — one Gemini call per document group, fingerprint-gated so
 * fresh entries never re-pay the provider). Dispatched by the
 * extraction.completed / document.approved consumers and by a cache miss
 * during getFormForClient — the wizard itself NEVER calls a provider.
 *
 * Idempotency: internally idempotent (fingerprint-checked cache upserts).
 * orgId is OPTIONAL in the envelope: event-driven enqueues omit it on purpose
 * so the webhook's permanent dedupe barrier cannot swallow future warms of
 * the same case (see cases/service.ts enqueueAiPrefillWarm).
 *
 * Retries: 2 (3 total attempts). Enqueued with timeout "280s".
 * Schedule: triggered on-demand (no cron).
 *
 * Boundary: imports ONLY from module-pub (cases/index.ts), platform/, shared/.
 */

import { z } from "zod";
import { logger } from "@/backend/platform/logger";
import { warmAiFieldCacheForCase } from "@/backend/modules/cases";

// ---------------------------------------------------------------------------
// Payload schema
// ---------------------------------------------------------------------------

// Lax uuid (regex, not z.uuid): seeded demo ids are not RFC-4122 v4 and the
// strict validator rejects them (see CLAUDE.md "UUIDs demo no-RFC").
const zUuidLax = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "uuid");

const RefreshAiPrefillPayloadSchema = z.object({
  jobKey: z.literal("refresh-ai-prefill"),
  entityId: zUuidLax,
  attempt: z.number().int().positive().default(1),
  dedupeId: z.string(),
  orgId: zUuidLax.optional(),
  caseId: zUuidLax,
  partyId: zUuidLax.nullable().optional(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles the refresh-ai-prefill QStash job.
 *
 * Delegates to cases.warmAiFieldCacheForCase. Returns void; throws on
 * retryable errors (QStash will retry).
 *
 * Called by the QStash route handler via JOB_REGISTRY.
 */
export async function handleRefreshAiPrefill(rawPayload: unknown): Promise<void> {
  const parseResult = RefreshAiPrefillPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    logger.error(
      { issues: parseResult.error.issues },
      "refresh-ai-prefill: invalid payload — skipping (non-retryable)",
    );
    return; // 2xx non-retryable: schema error
  }

  const payload = parseResult.data;

  logger.info(
    { job: "refresh-ai-prefill", caseId: payload.caseId, attempt: payload.attempt },
    "refresh-ai-prefill: start",
  );

  const outcome = await warmAiFieldCacheForCase(payload.caseId, payload.partyId ?? null);

  logger.info(
    { job: "refresh-ai-prefill", caseId: payload.caseId, outcome },
    "refresh-ai-prefill: done",
  );
}
