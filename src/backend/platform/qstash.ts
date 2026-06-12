/**
 * QStash client — DOC-26 §1 (job publishing and signature verification).
 *
 * Two responsibilities:
 * 1. `enqueueJob()` — publish a typed job payload to the QStash queue
 *    targeting `NEXT_PUBLIC_APP_URL/api/webhooks/qstash/[jobKey]`.
 * 2. `verifyQStashSignature()` — verify the `Upstash-Signature` JWT header
 *    on incoming webhook deliveries (supports key rotation natively).
 *
 * The `Receiver` from `@upstash/qstash` handles QSTASH_CURRENT_SIGNING_KEY
 * and QSTASH_NEXT_SIGNING_KEY rotation without downtime (DOC-27 §3.1).
 */

import { Client, Receiver } from "@upstash/qstash";
import { env, providerEnv } from "./env";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JobEnvelope {
  /** Must match the [job] route segment and the registry key */
  jobKey: string;
  /** Primary entity UUID the job operates on (null for cron jobs) */
  entityId: string | null;
  /** Logical business attempt number (not the QStash retry count) */
  attempt: number;
  /** Idempotency key: e.g. `run-generation:<entityId>:v<version>` */
  dedupeId: string;
  /** Additional job-specific fields */
  [key: string]: unknown;
}

export interface EnqueueOptions {
  /** QStash message-level retries (default 3, matching DOC-26 §5) */
  retries?: number;
  /** Delay before first delivery (seconds) */
  delay?: number;
  /** Schedule for cron-style delivery (QStash Schedules format) */
  cron?: string;
}

// ---------------------------------------------------------------------------
// Client factory (lazy — fails loud if provider not configured)
// ---------------------------------------------------------------------------

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    const qenv = providerEnv("qstash");
    _client = new Client({ token: qenv.QSTASH_TOKEN });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// enqueueJob
// ---------------------------------------------------------------------------

/**
 * Publishes a job to QStash targeting
 * `NEXT_PUBLIC_APP_URL/api/webhooks/qstash/{payload.jobKey}`.
 *
 * Also sets `Upstash-Deduplication-Id` to `payload.dedupeId` so QStash
 * drops duplicate publishes within its dedup window (DOC-26 §1.2).
 */
export async function enqueueJob(
  payload: JobEnvelope,
  options: EnqueueOptions = {},
): Promise<{ messageId: string }> {
  const url = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/qstash/${payload.jobKey}`;
  const client = getClient();

  const result = await client.publishJSON({
    url,
    body: payload,
    retries: options.retries ?? 3,
    deduplicationId: payload.dedupeId,
    ...(options.delay !== undefined && { delay: options.delay }),
  });

  logger.info(
    { jobKey: payload.jobKey, entityId: payload.entityId, messageId: result.messageId },
    "qstash: job enqueued",
  );

  return { messageId: result.messageId };
}

// ---------------------------------------------------------------------------
// verifyQStashSignature
// ---------------------------------------------------------------------------

/**
 * Verifies the `Upstash-Signature` JWT header on an incoming QStash delivery.
 *
 * Uses both QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY so key
 * rotation never causes downtime (DOC-27 §3.1).
 *
 * @param req - The incoming Next.js Request object
 * @returns The raw body string (for downstream Zod parsing)
 * @throws If signature is missing or invalid
 */
export async function verifyQStashSignature(req: Request): Promise<string> {
  const qenv = providerEnv("qstash");

  const receiver = new Receiver({
    currentSigningKey: qenv.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: qenv.QSTASH_NEXT_SIGNING_KEY,
  });

  // Read raw body ONCE before any parsing (DOC-27 §3.1: verify on raw bytes)
  const rawBody = await req.text();
  const signature = req.headers.get("Upstash-Signature") ?? "";

  const isValid = await receiver.verify({
    signature,
    body: rawBody,
  });

  if (!isValid) {
    throw new Error("QStash signature verification failed");
  }

  return rawBody;
}
