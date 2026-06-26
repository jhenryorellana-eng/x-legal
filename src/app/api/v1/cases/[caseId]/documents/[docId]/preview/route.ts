/**
 * GET /api/v1/cases/[caseId]/documents/[docId]/preview
 *
 * Streams a case document (or its rendered translation PDF) inline so it can be
 * previewed in-app without exposing a signed URL or forcing a download. The
 * client fetches this same-origin and renders the bytes via a blob URL (which
 * bypasses the global X-Frame-Options: DENY), so no header surgery is needed.
 *
 * Query:
 *   ?kind=source              → the uploaded document (default)
 *   ?kind=translation&direction=es-en → the rendered English/Spanish PDF
 *
 * Auth: staff/cliente with access to the case (enforced inside the module use
 * cases). Boundary: app → module-pub only (cases / ai-engine / identity).
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireActor, AuthzError } from "@/backend/modules/identity";
import { getCaseDocumentBytes, CaseError } from "@/backend/modules/cases";
import { getDocumentTranslationPdf } from "@/backend/modules/ai-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function inlineHeaders(mimeType: string, filename: string): HeadersInit {
  // RFC 5987 so accents/ñ in filenames survive (filename* with UTF-8 encoding).
  const encoded = encodeURIComponent(filename);
  return {
    "Content-Type": mimeType,
    "Content-Disposition": `inline; filename*=UTF-8''${encoded}`,
    "Cache-Control": "private, max-age=60",
  };
}

/** Copies into a plain ArrayBuffer — a clean BodyInit (sidesteps the
 *  Uint8Array<ArrayBufferLike> vs ArrayBuffer generic mismatch). */
function toBody(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string; docId: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { caseId, docId } = await params;
    const kind = request.nextUrl.searchParams.get("kind") ?? "source";

    if (kind === "translation") {
      const direction = request.nextUrl.searchParams.get("direction") === "en-es" ? "en-es" : "es-en";
      const file = await getDocumentTranslationPdf(actor, {
        caseId,
        caseDocumentId: docId,
        direction,
      });
      if (!file) {
        return NextResponse.json({ error: { code: "TRANSLATION_NOT_READY" } }, { status: 404 });
      }
      return new Response(toBody(file.bytes), {
        status: 200,
        headers: inlineHeaders(file.mimeType, file.filename),
      });
    }

    // Source path: getCaseDocumentBytes authorizes via the DB-derived doc.case_id
    // (not the URL caseId), so a mismatched URL caseId can never widen access.
    const file = await getCaseDocumentBytes(actor, docId);
    return new Response(toBody(file.bytes), {
      status: 200,
      headers: inlineHeaders(file.mimeType, file.filename),
    });
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
    }
    if (err instanceof CaseError) {
      const status = err.code === "DOC_NOT_FOUND" ? 404 : 403;
      return NextResponse.json({ error: { code: err.code } }, { status });
    }
    // AiEngineError is not thrown on these read paths today; if that changes it
    // falls through to a generic 500 (safe default — no data leaked).
    return NextResponse.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 });
  }
}
