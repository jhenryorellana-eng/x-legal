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
 * Current registry (F2 + F3):
 *   deliver-notification   — email / push channel delivery (DOC-26 SOT-7)
 *   appointment-reminders  — 24h / 1h appointment reminder cron (DOC-26 §2.7)
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyQStashSignature } from "@/backend/platform/qstash";
import { logger } from "@/backend/platform/logger";
import { handleDeliverNotification } from "@/backend/jobs/deliver-notification";
import { handleAppointmentReminders } from "@/backend/jobs/appointment-reminders";

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
};

// Export for tests that need to verify registry contents
export { JOB_REGISTRY };

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
