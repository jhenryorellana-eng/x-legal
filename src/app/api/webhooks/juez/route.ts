/**
 * Inbound webhook from Juez — /api/webhooks/juez
 *
 * Thin shell: reads raw body, verifies HMAC, dispatches to the evaluations
 * service layer. All business logic lives in evaluations/service.ts.
 *
 * Security (contract v1 §3.3 — mirror of api/webhooks/abogados):
 *   - POST only. Body read as raw text BEFORE any parse (signature is over raw bytes).
 *   - HMAC-SHA256 verified in constant time (timingSafeEqual).
 *   - Missing or invalid signature → 401 (no diagnostic info in response body).
 *   - Malformed payload / unknown token → 200 (legitimate signed sender; no retry value).
 *   - PDF download failures → 500 so Juez retries (it keeps the PDF until our 200).
 *   - Never log API keys, webhook secrets, tokens, or PII.
 *
 * Idempotency: owned by processJuezWebhook → claimWebhookEvent ({jobId}:{event}).
 */

import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/backend/platform/logger";
import { processJuezWebhook, EvaluationsError } from "@/backend/modules/evaluations";
import { JUEZ_SIGNATURE_HEADER } from "@/shared/constants/evaluations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Download+store of a ≤25MB PDF must fit comfortably before the ack. */
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Read raw body (MUST be raw text for HMAC verification)
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    logger.error({ err }, "juez-webhook: failed to read request body");
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }

  // 2. Extract signature header
  const signature = request.headers.get(JUEZ_SIGNATURE_HEADER);

  // 3. Dispatch to service (handles HMAC, parse, route, apply*)
  try {
    await processJuezWebhook(rawBody, signature);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EvaluationsError) {
      if (
        err.code === "WEBHOOK_SIGNATURE_MISSING" ||
        err.code === "WEBHOOK_SIGNATURE_INVALID"
      ) {
        // Intentionally dry 401 — no details to avoid timing/oracle attacks
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // PDF fetch/storage failures and unexpected errors → 500 (Juez retries;
    // it keeps its PDF copy until it receives our 200).
    logger.error({ err }, "juez-webhook: unexpected error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
