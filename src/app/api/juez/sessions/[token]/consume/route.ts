/**
 * Attempt consumption for Juez — POST /api/juez/sessions/{token}/consume
 *
 * Contract v1 §3.2 (docs/PROMPT-JUEZ-XLEGAL.md). Body: { jobId }.
 * Idempotent per jobId (case_evaluation_runs UNIQUE barrier):
 *   200 { ok: true, attemptsRemaining }  — consumed OR already consumed by this jobId
 *   409 { error: "NO_ATTEMPTS_LEFT" }    — no attempts left
 *   404                                  — unknown token
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  consumeAttempt,
  ConsumeBodySchema,
  verifyJuezApiKey,
} from "@/backend/modules/evaluations";
import { JUEZ_API_KEY_HEADER } from "@/shared/constants/evaluations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  if (!verifyJuezApiKey(request.headers.get(JUEZ_API_KEY_HEADER))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  let jobId: string;
  try {
    const body = ConsumeBodySchema.parse(await request.json());
    jobId = body.jobId;
  } catch {
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }

  try {
    const result = await consumeAttempt(token, jobId);
    if (!result) return NextResponse.json({ error: "Not Found" }, { status: 404 });

    if (result.outcome === "no_attempts") {
      return NextResponse.json({ error: "NO_ATTEMPTS_LEFT" }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      attemptsRemaining: Math.max(0, result.attemptsAllowed - result.attemptsUsed),
    });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
