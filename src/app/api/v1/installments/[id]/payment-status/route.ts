/**
 * API-BIL-03 — GET /api/v1/installments/[id]/payment-status
 *
 * Polling endpoint used by the client after returning from Stripe Checkout.
 * Returns installment + latest payment status.
 *
 * Auth: cliente (miembro del caso) · staff (billing:view)
 *
 * Boundary: app → module-pub only (requireActor via identity, service via billing).
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireActor } from "@/backend/modules/identity";
import { getInstallmentPaymentStatus, BillingError } from "@/backend/modules/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const result = await getInstallmentPaymentStatus(actor, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BillingError) {
      const status = err.code === "INSTALLMENT_NOT_FOUND" ? 404 : 409;
      return NextResponse.json(
        { error: { code: err.code, message: err.code } },
        { status },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal Server Error" } },
      { status: 500 },
    );
  }
}
