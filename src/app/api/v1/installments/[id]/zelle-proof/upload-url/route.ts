/**
 * API-BIL-04 — POST /api/v1/installments/[id]/zelle-proof/upload-url
 *
 * Returns a signed upload URL for a Zelle payment proof file.
 * After upload, client must call API-BIL-05 to confirm.
 *
 * Auth: cliente (miembro del caso)
 *
 * Boundary: app → module-pub only (requireActor via identity, upload URL via billing).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActor } from "@/backend/modules/identity";
import { getZelleProofUploadUrl, BillingError } from "@/backend/modules/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ProofUploadSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id: installmentId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: { code: "INVALID_BODY" } }, { status: 400 });
    }
    const parsed = ProofUploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } },
        { status: 422 },
      );
    }

    const { signedUrl, path } = await getZelleProofUploadUrl(actor, {
      installmentId,
      filename: parsed.data.filename,
      contentType: parsed.data.contentType,
    });

    return NextResponse.json({ signedUrl, path });
  } catch (err) {
    if (err instanceof BillingError) {
      const statusMap: Record<string, number> = {
        INSTALLMENT_NOT_FOUND: 404,
        INSTALLMENT_ALREADY_PAID: 409,
        RATE_LIMITED: 429,
      };
      const status = statusMap[err.code] ?? 500;
      return NextResponse.json({ error: { code: err.code } }, { status });
    }
    return NextResponse.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 });
  }
}
