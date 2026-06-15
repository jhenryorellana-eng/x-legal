/**
 * Inbound webhook from SaaS Abogados — /api/webhooks/abogados
 *
 * Thin shell: reads raw body, verifies HMAC, dispatches to the integrations
 * service layer. All business logic lives in integrations/service.ts.
 *
 * Security (DOC-70 §4.2, §8):
 *   - POST only. Body read as raw text BEFORE any parse (signature is over raw bytes).
 *   - HMAC-SHA256 verified in constant time (timingSafeEqual).
 *   - Missing or invalid signature → 401 (no diagnostic info in response body).
 *   - Malformed payload → 200 (legitimate sender, no reason to retry with same body).
 *   - Source mismatch → 200 (not our event; don't alarm the SaaS).
 *   - Never log API keys, webhook secrets, or PII.
 *
 * Idempotency: owned by processVerdictWebhook → applyVerdict → claimWebhookEvent.
 *
 * Pattern: mirrors src/app/api/webhooks/qstash/[job]/route.ts (thin shell → service).
 */

import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/backend/platform/logger";
import { processVerdictWebhook, IntegrationsError } from "@/backend/modules/integrations";
import { ABOGADOS_SIGNATURE_HEADER } from "@/shared/constants/integrations";

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Read raw body (MUST be raw text for HMAC verification — DOC-70 §4.2)
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    logger.error({ err }, "abogados-webhook: failed to read request body");
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }

  // 2. Extract signature header
  const signature = request.headers.get(ABOGADOS_SIGNATURE_HEADER);

  // 3. Dispatch to service (handles HMAC, parse, route, and applyVerdict)
  try {
    await processVerdictWebhook(rawBody, signature);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof IntegrationsError) {
      if (
        err.code === "WEBHOOK_SIGNATURE_MISSING" ||
        err.code === "WEBHOOK_SIGNATURE_INVALID"
      ) {
        // Intentionally dry 401 — no details to avoid timing/oracle attacks
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Unexpected error — log and return 500 (SaaS does NOT retry, §10)
    logger.error({ err }, "abogados-webhook: unexpected error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
