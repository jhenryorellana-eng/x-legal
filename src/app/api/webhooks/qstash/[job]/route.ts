/**
 * QStash webhook handler — /api/webhooks/qstash/[job]
 *
 * Receives and dispatches QStash job payloads.
 * Pattern (DOC-26 §1):
 *   1. Verify Upstash-Signature (HMAC)
 *   2. Parse job key from path
 *   3. Dispatch to registered job handler (JOB_REGISTRY below)
 *   4. Return 200 (QStash retries on 4xx/5xx)
 *
 * Security: only QStash-signed requests reach the handlers.
 * NEVER log the raw body (may contain PII).
 *
 * Handler registration: add entries to JOB_REGISTRY and import the handler
 * from its file in src/backend/jobs/. This route is in app-webhooks layer
 * which is allowed to import from jobs/ (DOC-21 boundary rules).
 *
 * Current registry (F2 + F3 + F4):
 *   deliver-notification      — email / push channel delivery (DOC-26 SOT-7)
 *   appointment-reminders     — 24h / 1h appointment reminder cron (DOC-26 §2.7)
 *   run-generation            — T1 legal generation via Claude (DOC-26 §2.1, F4)
 *   extract-document          — T3 extraction via Gemini (DOC-26 §2.2, F4)
 *   translate-document        — T4 translation via Gemini (DOC-26 §2.3, F4)
 *   ai-budget-aggregation     — AI spend threshold/close cron (DOC-26 §2.9, F4)
 *   job-failed                — QStash failure callback (DOC-26 §5.2, F4)
 *   retry-abogados-polling    — Abogados.com polling retry (DOC-70, DOC-26 §2.8, F6)
 *   installment-reminders     — overdue mark + due-3d/due-day client reminders (DOC-44 §3.9, F6-Ola2)
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyQStashSignature } from "@/backend/platform/qstash";
import { claimWebhookEvent, markWebhookEventProcessed } from "@/backend/platform/webhook-events";
import { logger } from "@/backend/platform/logger";
import type { Json } from "@/shared/database.types";
import { handleDeliverNotification } from "@/backend/jobs/deliver-notification";
import { handleAppointmentReminders } from "@/backend/jobs/appointment-reminders";
import { handleRunGeneration } from "@/backend/jobs/run-generation";
import { handleExtractDocument } from "@/backend/jobs/extract-document";
import { handleTranslateDocument } from "@/backend/jobs/translate-document";
import { handleAiBudgetAggregation } from "@/backend/jobs/ai-budget-aggregation";
import { handleJobFailed } from "@/backend/jobs/job-failed";
import { handleRetryAbogadosPolling } from "@/backend/jobs/retry-abogados-polling";
import { handleInstallmentReminders } from "@/backend/jobs/installment-reminders";
import { handleSendCampaign } from "@/backend/jobs/send-campaign";

// ---------------------------------------------------------------------------
// Job registry — jobKey → handler
//
// The registry lives in this route (app-webhooks layer) rather than in
// src/backend/jobs/ to respect boundary rule: "jobs → jobs" is not allowed,
// but "app-webhooks → jobs" IS allowed (DOC-21 §1, eslint-plugin-boundaries).
//
// Add new jobs: import the handler above, add an entry below.
// ---------------------------------------------------------------------------

type JobHandler = (payload: unknown) => Promise<void>;

const JOB_REGISTRY: Record<string, JobHandler> = {
  "deliver-notification": handleDeliverNotification,
  "appointment-reminders": handleAppointmentReminders,
  // F4 AI jobs
  "run-generation": handleRunGeneration,
  "extract-document": handleExtractDocument,
  "translate-document": handleTranslateDocument,
  "ai-budget-aggregation": handleAiBudgetAggregation,
  "job-failed": handleJobFailed,
  // F6 integrations (DOC-70, DOC-26 §2.8)
  "retry-abogados-polling": handleRetryAbogadosPolling,
  // F6-Ola2 billing cron (DOC-44 §3.9)
  "installment-reminders": handleInstallmentReminders,
  // F6-Ola3 campaigns (DOC-26 §2.5)
  "send-campaign": handleSendCampaign,
};

// On-demand AI jobs (run-generation/extract/translate) can run past the default
// 60s function limit — request up to 300s (capped by the Vercel plan; QStash
// retries on timeout regardless). DOC-82 §8.
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ job: string }> },
): Promise<Response> {
  const { job } = await params;

  // 1. Verify QStash signature
  let rawBody: string;
  try {
    rawBody = await verifyQStashSignature(request);
  } catch (err) {
    logger.warn({ err, job }, "qstash: signature verification failed");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse payload
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    logger.error({ job }, "qstash: failed to parse job payload as JSON");
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }

  // 3. Dispatch to handler from registry
  const handler = JOB_REGISTRY[job];
  if (!handler) {
    logger.warn({ job }, "qstash: no handler registered for job key");
    // Return 200 so QStash doesn't retry an unknown job forever (DOC-26 §5.1)
    return NextResponse.json({ ok: false, reason: "unknown_job" });
  }

  // 4. Idempotency barrier (DOC-26 §1.1 / DOC-27 §3.2). Only org-scoped jobs
  //    carry orgId + dedupeId; global crons rely on their own internal dedupe.
  const envelope = payload as Record<string, unknown> | null;
  const dedupeId = typeof envelope?.dedupeId === "string" ? envelope.dedupeId : null;
  const orgId = typeof envelope?.orgId === "string" ? envelope.orgId : null;

  if (dedupeId && orgId) {
    const claim = await claimWebhookEvent({
      source: "qstash",
      idempotencyKey: dedupeId,
      orgId,
      eventType: job,
      rawBody: payload as Json,
      signatureValid: true,
    });
    if (claim === "duplicate") {
      logger.info({ job, dedupeId }, "qstash: duplicate delivery skipped (already processed)");
      return NextResponse.json({ ok: true, reason: "duplicate" });
    }
    // "fresh" or "retry" (prior attempt died mid-flight) → run the idempotent handler.
    try {
      await handler(payload);
      await markWebhookEventProcessed("qstash", dedupeId);
      logger.info({ job, dedupeId }, "qstash: job completed");
      return NextResponse.json({ ok: true });
    } catch (err) {
      logger.error({ err, job }, "qstash: job handler threw — will retry");
      return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
  }

  // Crons / jobs without orgId: dispatch directly (handlers are internally idempotent).
  try {
    await handler(payload);
    logger.info({ job }, "qstash: job completed");
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Throw to trigger QStash retry (DOC-26 §5.1: transient errors → 5xx)
    logger.error({ err, job }, "qstash: job handler threw — will retry");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
