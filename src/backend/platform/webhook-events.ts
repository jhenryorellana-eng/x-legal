/**
 * Webhook idempotency barrier (DOC-26 §1.1 / DOC-27 §3.2).
 *
 * Records every signed delivery in `webhook_events` (UNIQUE (source,
 * idempotency_key)) so a re-delivery (QStash retry after a 5xx/timeout, or a
 * provider replay) is detected at ingress — the second barrier complementing
 * QStash's own `Upstash-Deduplication-Id` and the handlers' entity-level guards.
 *
 * org_id is NOT NULL on the table, so this barrier applies only to org-scoped
 * deliveries that carry an orgId. Global crons (no org) rely on their own
 * internal idempotency (e.g. reminder_sent_at, notification dedupe_key).
 */

import { createServiceClient } from "./supabase";
import { logger } from "./logger";
import type { Json } from "@/shared/database.types";

export type WebhookClaim = "fresh" | "duplicate" | "retry";

/**
 * Claims a webhook delivery.
 *  - "fresh"     → first time we see it; run the handler then markProcessed.
 *  - "duplicate" → already processed (processed_at set); skip the handler.
 *  - "retry"     → a prior attempt died mid-flight (processed_at null); re-run
 *                  (handlers are idempotent). Also returned on unexpected DB
 *                  errors so we fail OPEN (process) rather than drop the job.
 */
export async function claimWebhookEvent(input: {
  source: string;
  idempotencyKey: string;
  orgId: string;
  eventType?: string | null;
  rawBody: Json;
  signatureValid: boolean;
}): Promise<WebhookClaim> {
  const client = createServiceClient();
  const { error } = await client.from("webhook_events").insert({
    source: input.source,
    idempotency_key: input.idempotencyKey,
    org_id: input.orgId,
    event_type: input.eventType ?? null,
    raw_body: input.rawBody,
    signature_valid: input.signatureValid,
  });

  if (!error) return "fresh";

  // Unique violation (23505) → we've seen this delivery before.
  if ((error as { code?: string }).code === "23505") {
    const { data } = await client
      .from("webhook_events")
      .select("processed_at")
      .eq("source", input.source)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    return data?.processed_at ? "duplicate" : "retry";
  }

  logger.warn(
    { err: error, source: input.source },
    "webhook-events: claim insert failed — failing open (will process)",
  );
  return "retry";
}

/** Marks a claimed delivery as fully processed (so future re-deliveries skip). */
export async function markWebhookEventProcessed(
  source: string,
  idempotencyKey: string,
): Promise<void> {
  const client = createServiceClient();
  await client
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("source", source)
    .eq("idempotency_key", idempotencyKey);
}
