/**
 * GET /api/v1/zip-lookup?zip=NNNNN — resolves a US ZIP to { city, state }.
 *
 * Consumed by the "Nuevo caso" wizard (step 1 address autofill, RF-VAN-018) via
 * the `useUsZipLookup` hook. Thin handler per DOC-21 §4: auth → validate →
 * service → json. Server-side proxy to zippopotam.us — the browser cannot call
 * it directly (CSP `connect-src 'self'`, DOC-27 §6).
 *
 * Auth: staff only (the intake forms that use it are staff surfaces).
 * Errors: 400 INVALID_ZIP · 401 UNAUTHORIZED · 403 FORBIDDEN ·
 *         404 ZIP_NOT_FOUND · 502 ZIP_LOOKUP_FAILED.
 *
 * Boundary: app → module-pub only (identity).
 */

import { NextResponse, type NextRequest } from "next/server";
import { getActor, lookupUsZip, US_ZIP_REGEX } from "@/backend/modules/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, status: number): Response {
  return NextResponse.json({ error: { code, message: code } }, { status });
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const actor = await getActor();
    if (!actor) return errorResponse("UNAUTHORIZED", 401);
    if (actor.kind !== "staff") return errorResponse("FORBIDDEN", 403);

    const zip = (request.nextUrl.searchParams.get("zip") ?? "").trim();
    if (!US_ZIP_REGEX.test(zip)) return errorResponse("INVALID_ZIP", 400);

    const result = await lookupUsZip(zip);
    if (result.status === "not_found") return errorResponse("ZIP_NOT_FOUND", 404);
    if (result.status === "failed") return errorResponse("ZIP_LOOKUP_FAILED", 502);

    return NextResponse.json(
      { city: result.city, state: result.state },
      {
        headers: {
          // ZIP → city/state is effectively static; cache per-browser for a day
          // (private: the route is authenticated, so no shared/CDN cache).
          "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch {
    return errorResponse("INTERNAL_ERROR", 500);
  }
}
