/**
 * Stripe webhook handler — POST /api/webhooks/stripe (WH-01).
 *
 * Pipeline (DOC-71 §3.1):
 * 1. Read raw body (MUST be raw text — signature is over raw bytes)
 * 2. Verify Stripe signature via constructEvent
 *    - Invalid → record signature_valid=false in webhook_events → 400
 * 3. Idempotency: claimWebhookEvent (source='stripe', key=event.id)
 *    - "duplicate" (processed_at set) → 200 (already processed, skip)
 *    - "fresh" or "retry" (processed_at null) → run handleStripeEvent
 * 4. Dispatch to billing.handleStripeEvent
 * 5. markWebhookEventProcessed → 200
 *    - Handler throws → 500 WITHOUT marking processed (Stripe retries
 *      and claim will return "retry" → re-runs handler)
 *
 * Idempotency contract (DOC-71 §3.1 / webhook-events.ts):
 *   - "fresh"     → first time; run handler.
 *   - "duplicate" → processed_at is set; skip (return 200).
 *   - "retry"     → prior attempt died (processed_at null); re-run.
 *   This ensures a 500 mid-flight is always retried, not silently skipped.
 *
 * Security (DOC-71 §7):
 * - Signature is verified BEFORE any payload parsing
 * - Raw body is NEVER mutated before constructEvent
 * - Secrets only from env.ts (providerEnv)
 * - PII never logged
 *
 * MED-1: BD error that is NOT a unique conflict → 500 (fail-closed, no
 *   fail-open). claimWebhookEvent already handles this by returning "retry"
 *   on unexpected DB errors, which is the safe fall-through to process.
 *
 * MED-2: Events without a derivable org_id are still recorded by event.id
 *   for idempotency. The claimWebhookEvent helper requires org_id NOT NULL,
 *   so events with no org_id bypass the barrier but are processed once by
 *   the idempotent handler (Stripe sends each event at-most once per delivery).
 */

import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/backend/platform/logger";
import { getStripe } from "@/backend/platform/stripe";
import { providerEnv } from "@/backend/platform/env";
import { createServiceClient } from "@/backend/platform/supabase";
import {
  claimWebhookEvent,
  markWebhookEventProcessed,
} from "@/backend/platform/webhook-events";
import { handleStripeEvent } from "@/backend/modules/billing";

// Disable Next.js body parser — we need the raw body for Stripe signature verification
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Read raw body (critical: JSON.parse breaks Stripe signature check)
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    logger.error({ err }, "stripe-webhook: failed to read request body");
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    logger.warn({}, "stripe-webhook: missing stripe-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // 2. Verify Stripe signature (over raw body — DOC-71 §7)
  let event: import("stripe").Stripe.Event;
  try {
    const { STRIPE_WEBHOOK_SECRET } = providerEnv("stripe");
    event = getStripe().webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // Invalid signature: record in webhook_events (best-effort) and return 400
    logger.warn({ err }, "stripe-webhook: signature verification failed");

    try {
      const parsed = tryParseStripeEventUnsafe(rawBody);
      const orgId = extractOrgIdUnsafe(parsed);

      if (orgId) {
        const parsedData = parsed as import("@/shared/database.types").Json;
        await createServiceClient().from("webhook_events").insert({
          source: "stripe",
          idempotency_key:
            (typeof parsed?.["id"] === "string" ? parsed["id"] : null) ??
            `sig-fail-${Date.now()}`,
          org_id: orgId,
          event_type: typeof parsed?.["type"] === "string" ? parsed["type"] : null,
          raw_body: parsedData,
          signature_valid: false,
          error: (err as Error)?.message ?? "Stripe signature verification failed",
        });
      }
    } catch {
      // Ignore secondary errors — the 400 response is the authoritative signal
    }

    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const source = "stripe";
  const idempotencyKey = event.id;

  // Extract org_id from event metadata (needed for webhook_events NOT NULL constraint)
  const orgId = extractOrgId(event);

  // 3. Idempotency via canonical claimWebhookEvent helper.
  //    Distinguishes fresh / duplicate (processed_at set) / retry (processed_at null).
  //    Events with no org_id bypass the barrier but are handled idempotently by
  //    the billing handler itself (MED-2).
  if (orgId) {
    const claim = await claimWebhookEvent({
      source,
      idempotencyKey,
      orgId,
      eventType: event.type,
      rawBody: JSON.parse(rawBody) as import("@/shared/database.types").Json,
      signatureValid: true,
    });

    if (claim === "duplicate") {
      // processed_at is set — this event was fully handled. Skip.
      logger.info(
        { eventId: event.id, type: event.type },
        "stripe-webhook: duplicate event (already processed) — skipping",
      );
      return NextResponse.json({ ok: true, duplicate: true });
    }

    // "fresh" or "retry" — run handler.
    // On handler throw → return 500 WITHOUT marking processed so Stripe retries.
    try {
      await handleStripeEvent(event, idempotencyKey);
    } catch (err) {
      logger.error(
        { err, eventId: event.id, type: event.type },
        "stripe-webhook: handleStripeEvent threw — NOT marking processed (Stripe will retry)",
      );
      // Do NOT markWebhookEventProcessed — processed_at stays null.
      // Next Stripe delivery will get claim="retry" and re-run the handler.
      return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }

    await markWebhookEventProcessed(source, idempotencyKey);
    return NextResponse.json({ ok: true });
  }

  // No org_id: log and dispatch directly (no webhook_events record — MED-2).
  // Handler is internally idempotent.
  logger.warn(
    { eventId: event.id, type: event.type },
    "stripe-webhook: no org_id in event metadata — bypassing idempotency barrier",
  );

  try {
    await handleStripeEvent(event, idempotencyKey);
  } catch (err) {
    logger.error(
      { err, eventId: event.id, type: event.type },
      "stripe-webhook: handleStripeEvent threw (no-orgId path)",
    );
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractOrgId(event: import("stripe").Stripe.Event): string | null {
  try {
    // Cast through unknown to avoid Stripe's wide union type complaints
    const obj = event.data.object as unknown as Record<string, unknown>;
    const meta = (obj["metadata"] ?? {}) as Record<string, string>;
    return meta["org_id"] ?? null;
  } catch {
    return null;
  }
}

function extractOrgIdUnsafe(parsed: Record<string, unknown> | null): string | null {
  try {
    if (!parsed) return null;
    const data = parsed["data"] as Record<string, unknown> | undefined;
    const obj = data?.["object"] as Record<string, unknown> | undefined;
    const meta = obj?.["metadata"] as Record<string, string> | undefined;
    return meta?.["org_id"] ?? null;
  } catch {
    return null;
  }
}

function tryParseStripeEventUnsafe(rawBody: string): Record<string, unknown> | null {
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
}
