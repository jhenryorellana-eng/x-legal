/**
 * Server-to-server session read for Juez — GET /api/juez/sessions/{token}
 *
 * Contract v1 §3.1 (docs/PROMPT-JUEZ-XLEGAL.md). Auth: `x-api-key` verified in
 * constant time by the evaluations module. Responses are dry: 401 without
 * detail, 404 for unknown tokens. Errors are logged inside the module.
 *
 * Wire format (Juez owns it — Spanish field names):
 *   { cliente: {nombre,email,pais}, attemptsAllowed, attemptsUsed,
 *     status: "active"|"delivered"|"expired", pdf: {available, downloadUrl?} }
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  getSessionForJuez,
  projectSessionStatus,
  verifyJuezApiKey,
} from "@/backend/modules/evaluations";
import { JUEZ_API_KEY_HEADER } from "@/shared/constants/evaluations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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

  try {
    const session = await getSessionForJuez(token);
    if (!session) return NextResponse.json({ error: "Not Found" }, { status: 404 });

    return NextResponse.json({
      cliente: {
        nombre: session.client.name,
        email: session.client.email,
        pais: session.client.country,
      },
      attemptsAllowed: session.attemptsAllowed,
      attemptsUsed: session.attemptsUsed,
      status: projectSessionStatus(session.status),
      pdf: session.pdfUrl
        ? { available: true, downloadUrl: session.pdfUrl }
        : { available: false },
    });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
