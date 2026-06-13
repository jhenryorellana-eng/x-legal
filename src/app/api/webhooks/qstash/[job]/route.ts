/**
 * QStash webhook handler — /api/webhooks/qstash/[job]
 *
 * Receives and dispatches QStash job payloads.
 * Pattern (DOC-26 §1):
 *   1. Verify Upstash-Signature (HMAC)
 *   2. Parse job key from path
 *   3. Dispatch to registered job handler
 *   4. Return 200 (QStash retries on 4xx/5xx)
 *
 * Security: only QStash-signed requests reach the handlers.
 * NEVER log the raw body (may contain PII).
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyQStashSignature } from "@/backend/platform/qstash";
import { logger } from "@/backend/platform/logger";
import { handleDeliverNotification } from "@/backend/jobs/deliver-notification";

// ---------------------------------------------------------------------------
// Job registry
// ---------------------------------------------------------------------------

type JobHandler = (payload: unknown) => Promise<void>;

const JOB_REGISTRY: Record<string, JobHandler> = {
  "deliver-notification": handleDeliverNotification,
};

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

  // 3. Dispatch to handler
  const handler = JOB_REGISTRY[job];
  if (!handler) {
    logger.warn({ job }, "qstash: no handler registered for job key");
    // Return 200 so QStash doesn't retry an unknown job forever
    return NextResponse.json({ ok: false, reason: "unknown_job" });
  }

  try {
    await handler(payload);
    logger.info({ job }, "qstash: job completed");
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Throw to trigger QStash retry
    logger.error({ err, job }, "qstash: job handler threw — will retry");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
