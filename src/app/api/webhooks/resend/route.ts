/**
 * Resend webhook handler — POST /api/webhooks/resend (WH-05, DOC-73 §5).
 *
 * Pipeline:
 *  1. Read raw body (svix signature is over raw bytes).
 *  2. Verify svix signature (RESEND_WEBHOOK_SECRET). Invalid → 401.
 *  3. Idempotency: claimWebhookEvent (source='resend', key=svix-id) when the
 *     recipient's org resolves; otherwise process directly (handler is idempotent).
 *  4. Dispatch to campaigns.applyResendEvent:
 *       email.delivered  → stamp last_event_at
 *       email.bounced    → recipient 'bounced' + users.email_bounced_at
 *       email.complained → recipient 'complained' + marketing_opt_in=false
 *  5. On handler error → persist error + 200 (Resend status events aren't worth retrying).
 *
 * Security: signature verified BEFORE any parsing; secrets only from env.ts.
 */

import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { providerEnv } from "@/backend/platform/env";
import { logger } from "@/backend/platform/logger";
import {
  claimWebhookEvent,
  markWebhookEventProcessed,
  markWebhookEventError,
} from "@/backend/platform/webhook-events";
import { applyResendEvent, resolveRecipientOrg } from "@/backend/modules/campaigns";
import type { Json } from "@/shared/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResendWebhookPayload {
  type: string;
  created_at?: string;
  data?: { to?: string[]; email?: string; email_id?: string };
}

function extractEmail(payload: ResendWebhookPayload): string | null {
  const to = payload.data?.to;
  if (Array.isArray(to) && to.length > 0) return to[0];
  return payload.data?.email ?? null;
}

export async function POST(request: NextRequest): Promise<Response> {
  const rawBody = await request.text();

  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  // 1+2. Verify svix signature.
  let payload: ResendWebhookPayload;
  try {
    const wh = new Webhook(providerEnv("resend").RESEND_WEBHOOK_SECRET);
    payload = wh.verify(rawBody, headers) as ResendWebhookPayload;
  } catch (err) {
    logger.warn({ err }, "resend-webhook: signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const svixId = headers["svix-id"];
  const email = extractEmail(payload);
  const at = payload.created_at ?? new Date().toISOString();
  const evt = { type: payload.type, email, at };

  const orgId = await resolveRecipientOrg(email);

  // 3. Idempotency barrier when org resolves (handler is idempotent regardless).
  if (orgId && svixId) {
    const claim = await claimWebhookEvent({
      source: "resend",
      idempotencyKey: svixId,
      orgId,
      eventType: payload.type,
      rawBody: JSON.parse(rawBody) as Json,
      signatureValid: true,
    });
    if (claim === "duplicate") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    try {
      await applyResendEvent(evt);
    } catch (err) {
      logger.error({ err, type: payload.type }, "resend-webhook: handler threw");
      await markWebhookEventError("resend", svixId, (err as Error)?.message ?? "handler error");
      return NextResponse.json({ ok: false }); // 200: don't retry status events
    }
    await markWebhookEventProcessed("resend", svixId);
    return NextResponse.json({ ok: true });
  }

  // No org / no svix-id: process directly (idempotent), MED-2 pattern.
  try {
    await applyResendEvent(evt);
  } catch (err) {
    logger.error({ err, type: payload.type }, "resend-webhook: handler threw (no-org path)");
    return NextResponse.json({ ok: false });
  }
  return NextResponse.json({ ok: true });
}
