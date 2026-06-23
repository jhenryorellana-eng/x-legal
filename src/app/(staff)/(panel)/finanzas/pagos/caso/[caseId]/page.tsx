/**
 * Estado de cuenta — `/finanzas/pagos/caso/[caseId]` (Andrium · finance).
 *
 * Server component (RSC): loads AccountStatementDto via getAccountStatement,
 * maps to serialisable VM, injects server actions, mounts
 * <PagosCasoView/>.
 *
 * Sources of truth:
 *  - DOC-55-UI-ANDRIUM §3.5 (estado de cuenta, RF-AND-021)
 *  - PROMPT-AND-03 overlay "Estado de cuenta por caso"
 *  - RF-AND-008–022
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getActor, can } from "@/backend/modules/identity";
import { getAccountStatement, BillingError, type AccountStatementDto } from "@/backend/modules/billing";
import {
  PagosCasoView,
  type PagosCasoVM,
  type InstallmentVM,
  type PaymentVM,
} from "@/frontend/features/andrium/pagos/pagos-caso-view";
import {
  createInstallmentCheckoutAction,
  confirmZellePaymentAction,
  rejectZelleProofAction,
  registerZellePaymentAction,
  getZelleProofUploadUrlAction,
  getZelleProofViewUrlAction,
  rescheduleInstallmentAction,
  waiveInstallmentAction,
} from "./actions";

// ---------------------------------------------------------------------------
// Mapper: AccountStatementDto → PagosCasoVM (no backend types cross boundary)
// ---------------------------------------------------------------------------

function toPaymentVM(p: AccountStatementDto["installments"][0]["payments"][0]): PaymentVM {
  return {
    id: p.id,
    method: p.method,
    status: p.status as PaymentVM["status"],
    amountCents: p.amountCents,
    createdAt: p.createdAt,
    confirmedAt: p.confirmedAt,
  };
}

function toInstallmentVM(
  i: AccountStatementDto["installments"][0],
): InstallmentVM {
  return {
    id: i.id,
    number: i.number,
    isDownpayment: i.isDownpayment,
    amountCents: i.amountCents,
    dueDate: i.dueDate,
    status: i.status,
    paidAt: i.paidAt,
    payments: i.payments.map(toPaymentVM),
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PagosCasoPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ paymentId?: string }>;
}) {
  const { caseId } = await params;
  const { paymentId } = await searchParams;

  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  try {
    can(actor, "billing", "view");
  } catch {
    redirect("/finanzas");
  }

  let vm: PagosCasoVM = {
    caseId,
    plan: null,
    installments: [],
    aggregates: { paidCents: 0, pendingCents: 0, overdueCents: 0, waivedCents: 0, totalCents: 0 },
    focusedPaymentId: paymentId ?? null,
    loadError: false,
  };

  try {
    const stmt = await getAccountStatement(actor, caseId);
    vm = {
      caseId,
      plan: stmt.plan
        ? {
            totalCents: stmt.plan.totalCents,
            downpaymentCents: stmt.plan.downpaymentCents,
            installmentCount: stmt.plan.installmentCount,
            notes: stmt.plan.notes,
          }
        : null,
      installments: stmt.installments.map(toInstallmentVM),
      aggregates: stmt.aggregates,
      focusedPaymentId: paymentId ?? null,
      loadError: false,
    };
  } catch (err) {
    if (!(err instanceof BillingError)) throw err;
    vm = { ...vm, loadError: true };
  }

  return (
    <div>
      <PagosCasoView
        vm={vm}
        actions={{
          createInstallmentCheckout: createInstallmentCheckoutAction,
          confirmZellePayment: confirmZellePaymentAction,
          rejectZelleProof: rejectZelleProofAction,
          registerZellePayment: registerZellePaymentAction,
          getZelleProofUploadUrl: getZelleProofUploadUrlAction,
          getZelleProofViewUrl: getZelleProofViewUrlAction,
          rescheduleInstallment: rescheduleInstallmentAction,
          waiveInstallment: waiveInstallmentAction,
        }}
      />
    </div>
  );
}
