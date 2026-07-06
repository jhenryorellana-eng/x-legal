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

import { createHmac, timingSafeEqual } from "node:crypto";
import { Client, Receiver } from "@upstash/qstash";
import { env, providerEnv } from "./env";
import { logger } from "./logger";
import { isAiStubEnabled } from "./ai-stub";

// ---------------------------------------------------------------------------
// Local-dev job dispatch (DX)
//
// QStash can only deliver to a PUBLIC url — it refuses to even publish a job
// whose callback resolves to a loopback address ("invalid destination url:
// endpoint resolves to a loopback address"). That makes the whole async
// pipeline (AI extraction/translation, reminders, campaigns, …) impossible to
// exercise in local dev against real providers.
//
// Outside production, when the callback base url is loopback, `enqueueJob`
// dispatches the job straight to the LOCAL webhook over HTTP instead of QStash.
// The request carries a derived shared secret so `verifyQStashSignature` can
// tell a genuine self-dispatch from an unauthenticated request. Both ends are
// hard-gated to `NODE_ENV !== "production"`, so production behaviour is byte-for
// -byte unchanged: a real QStash delivery is the only path there.
// ---------------------------------------------------------------------------

const LOCAL_DISPATCH_HEADER = "x-local-job-dispatch";

/** True when a callback URL points at this machine (QStash cannot reach it). */
function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  } catch {
    return false;
  }
}

/**
 * Origin of THIS running dev server for the self-dispatch. Prefers the runtime
 * PORT (set by `next dev -p <port>` / an explicit `PORT=…`) so it hits the actual
 * listening port even when `NEXT_PUBLIC_APP_URL` names a different one; falls back
 * to the configured callback base.
 */
function localWebhookBase(): string {
  const port = process.env.PORT?.trim();
  if (port) return `http://127.0.0.1:${port}`;
  return jobCallbackBaseUrl();
}

/**
 * Shared secret for the local self-dispatch, derived from the QStash signing key
 * (already a deployment secret) so it needs no new env var and is not guessable.
 * Only ever honored outside production.
 */
function localDispatchToken(): string {
  const qenv = providerEnv("qstash");
  return createHmac("sha256", qenv.QSTASH_CURRENT_SIGNING_KEY)
    .update("local-job-dispatch/v1")
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

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
    _client = new Client({
      token: qenv.QSTASH_TOKEN,
      ...(qenv.QSTASH_URL ? { baseUrl: qenv.QSTASH_URL } : {}),
    });
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
/**
 * Public base URL that QStash must call back. QStash can ONLY deliver to a public
 * URL — if `NEXT_PUBLIC_APP_URL` is missing or points at localhost (a common env
 * misconfig that makes EVERY job — push/email/AI/reminders — silently fail to
 * publish), fall back to the Vercel-injected production domain so jobs still get
 * delivered. Outside Vercel (local dev) the configured value is used as-is.
 */
function jobCallbackBaseUrl(): string {
  const configured = env.NEXT_PUBLIC_APP_URL;
  const bad = !configured || /localhost|127\.0\.0\.1/.test(configured);
  if (bad) {
    const vercelHost =
      process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    if (vercelHost) return `https://${vercelHost}`;
  }
  return configured;
}

/**
 * QStash rejects a `deduplicationId` containing `:` (HTTP 400
 * "DeduplicationId cannot contain ':'") — but our dedupeId convention uses `:`
 * as a separator (e.g. `translate-document:<docId>:<direction>`). Map every
 * character outside QStash's safe set to `_`. The transform is deterministic,
 * so retries of the same logical job still collapse to one message.
 */
export function toQStashDeduplicationId(dedupeId: string): string {
  return dedupeId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function enqueueJob(
  payload: JobEnvelope,
  options: EnqueueOptions = {},
): Promise<{ messageId: string }> {
  const url = `${jobCallbackBaseUrl()}/api/webhooks/qstash/${payload.jobKey}`;

  // Local dev (non-production, loopback callback): dispatch straight to the local
  // webhook — QStash would reject a loopback destination. Fire-and-forget to keep
  // async semantics; the webhook runs the handler in its own request and is
  // internally idempotent (dedupe barrier on dedupeId+orgId), so a delay option
  // is intentionally not honored here (dev-only convenience).
  if (process.env.NODE_ENV !== "production" && isLoopbackUrl(url)) {
    const dispatchUrl = `${localWebhookBase()}/api/webhooks/qstash/${payload.jobKey}`;
    void fetch(dispatchUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [LOCAL_DISPATCH_HEADER]: localDispatchToken(),
      },
      body: JSON.stringify(payload),
    }).catch((err) =>
      logger.warn({ err, jobKey: payload.jobKey }, "qstash: local job dispatch failed"),
    );
    logger.info(
      { jobKey: payload.jobKey, entityId: payload.entityId },
      "qstash: job dispatched to local webhook (loopback callback, non-production)",
    );
    return { messageId: `local-${toQStashDeduplicationId(payload.dedupeId)}` };
  }

  const client = getClient();

  const result = await client.publishJSON({
    url,
    body: payload,
    retries: options.retries ?? 3,
    deduplicationId: toQStashDeduplicationId(payload.dedupeId),
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
  // E2E / CI test seam (DOC-81 §4.3.5 "job con firma simulada"): when the AI
  // stub is active — which `isAiStubEnabled()` makes IMPOSSIBLE in production
  // (it throws there) — AND the caller opts in with an explicit header, accept
  // the delivery without a real Upstash JWT. This lets Playwright drive the job
  // handlers through the real webhook route without reverse-engineering QStash's
  // signer. Both conditions are required: a genuine QStash delivery in dev (no
  // header) still goes through full signature verification below.
  if (isAiStubEnabled() && req.headers.get("x-e2e-qstash-bypass") === "1") {
    return await req.text();
  }

  // Local self-dispatch (see enqueueJob): outside production only, and only with
  // the derived shared secret. A real QStash delivery never carries this header,
  // and in production this branch is skipped entirely.
  if (process.env.NODE_ENV !== "production") {
    const localToken = req.headers.get(LOCAL_DISPATCH_HEADER);
    if (localToken && safeEqualHex(localToken, localDispatchToken())) {
      return await req.text();
    }
  }

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
