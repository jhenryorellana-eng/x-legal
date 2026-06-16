/**
 * API-BIL-05 — POST /api/v1/installments/[id]/zelle-proof
 *
 * Confirms a Zelle proof upload and registers the pending payment.
 * Must be called AFTER the signed upload URL was used (API-BIL-04).
 *
 * Body: { proofPath: string }
 *
 * Auth: cliente (miembro del caso)
 *
 * Boundary: app → module-pub only (requireActor via identity, submitZelleProof via billing).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActor } from "@/backend/modules/identity";
import { submitZelleProof, BillingError } from "@/backend/modules/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SubmitProofSchema = z.object({
  proofPath: z.string().min(1),
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

    const parsed = SubmitProofSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } },
        { status: 422 },
      );
    }

    await submitZelleProof(actor, {
      installmentId,
      proofPath: parsed.data.proofPath,
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    if (err instanceof BillingError) {
      const statusMap: Record<string, number> = {
        INSTALLMENT_NOT_FOUND: 404,
        INSTALLMENT_ALREADY_PAID: 409,
        INSTALLMENT_NOT_PAYABLE: 409,
        PROOF_ALREADY_SUBMITTED: 409,
        PROOF_INVALID_FILE: 422,
      };
      const status = statusMap[err.code] ?? 500;
      return NextResponse.json({ error: { code: err.code } }, { status });
    }
    return NextResponse.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 });
  }
}
