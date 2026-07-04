"use client";

/**
 * Pagos tab (DOC-53 §3.4 — billing) — account statement (installments) with:
 *  - Manual Zelle registration with MANDATORY proof upload (Henry 2026-07-02)
 *  - Zelle proof verification (view + approve/reject) for admin / sales /
 *    finance, reusing the billing-shared panel (RF-AND-011) so the asesora can
 *    verify her client's comprobante without leaving the case.
 * Waive / reschedule stay on the finance surface (/finanzas/pagos/caso/[id]).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { toast } from "@/frontend/components/desktop/toast";
import { ZelleVerifyPanel, ZelleRegisterModal } from "@/frontend/features/billing-shared";
import type { CaseWorkspaceVM, CaseDetailActions, InstallmentVM, InstallmentPaymentVM } from "../types";
import type { CasosStrings } from "../strings";
import { interp } from "../strings";
import { formatCents, SectionLabel } from "../ui";
import { buildZelleVerifyStrings, buildZelleRegisterStrings } from "../zelle-strings";

function chipFor(inst: InstallmentVM, t: CasosStrings["detail"]): { tone: "green" | "blue" | "amber" | "gold"; label: string } {
  switch (inst.status) {
    case "paid":
      return { tone: "green", label: t.paid };
    case "overdue":
      return { tone: "amber", label: t.overdue };
    case "processing":
      return { tone: "gold", label: t.zelleProcessing };
    case "scheduled":
      return { tone: "blue", label: t.scheduled };
    case "waived":
      return { tone: "gold", label: t.waived };
    default:
      return { tone: "blue", label: t.due };
  }
}

/** The pending Zelle payment of an installment (drives "Verificar"), if any. */
function pendingZelleOf(inst: InstallmentVM): InstallmentPaymentVM | null {
  return inst.payments.find((p) => p.method === "zelle" && p.status === "pending") ?? null;
}

/** Maps an autopay_disabled_reason to its localized label (DOC-71 §2.4). */
function autopayReasonLabel(reason: string, t: CasosStrings["detail"]): string {
  switch (reason) {
    case "card_declined_max_retries":
      return t.autopayReasonCardDeclined;
    case "authentication_required":
      return t.autopayReasonAuthRequired;
    case "customer_request":
      return t.autopayReasonCustomer;
    case "staff_request":
      return t.autopayReasonStaff;
    case "refund_issued":
      return t.autopayReasonRefund;
    default:
      return reason;
  }
}

export function PagosTab({
  vm,
  actions,
  strings,
  locale,
}: {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
  locale: "es" | "en";
}) {
  const t = strings.detail;
  const router = useRouter();
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const [verifyPayment, setVerifyPayment] = React.useState<{
    id: string;
    amountCents: number;
    createdAt: string;
  } | null>(null);

  // Payment controls are a staff affordance for admin / sales / finance only
  // (paralegal keeps the read-only statement even if the tab is enabled).
  const canOperate = vm.isAdmin || vm.role === "sales" || vm.role === "finance";
  const canVerify =
    canOperate &&
    !!actions.confirmZellePayment &&
    !!actions.rejectZelleProof &&
    !!actions.getZelleProofViewUrl;
  const canRegister = canOperate && !!actions.getZelleProofUploadUrl;

  const verifyStrings = buildZelleVerifyStrings(t);
  const registerStrings = buildZelleRegisterStrings(t);

  const downpaymentInstallment = vm.downpaymentInstallmentId
    ? vm.installments.find((i) => i.id === vm.downpaymentInstallmentId) ?? null
    : null;

  async function handleApprove(paymentId: string) {
    const res = await actions.confirmZellePayment!({ paymentId });
    if (res.ok) {
      toast.success(t.zelleApprovedToast);
      setVerifyPayment(null);
      router.refresh();
    } else {
      toast.error(strings.errorTitle);
      router.refresh();
    }
  }

  async function handleReject(paymentId: string, reason: string) {
    const res = await actions.rejectZelleProof!({ paymentId, reason });
    if (res.ok) {
      toast.success(t.zelleRejectedToast);
      setVerifyPayment(null);
      router.refresh();
    } else {
      toast.error(strings.errorTitle);
    }
  }

  async function handleRegister(input: {
    installmentId: string;
    zelleProofPath: string;
    notes?: string | null;
  }) {
    const res = await actions.registerPayment(input);
    if (res.ok) {
      toast.success(t.paymentDone);
      setRegisterOpen(false);
      router.refresh();
    } else {
      toast.error(strings.errorTitle);
    }
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SectionLabel icon="wallet">{t.pagosTitle}</SectionLabel>
        {vm.planFrequency && (
          <Chip tone="blue">
            {vm.planFrequency === "weekly" ? t.planWeekly : t.planMonthly}
          </Chip>
        )}
        {vm.planAutopayEnabled && <Chip tone="green">{t.autopayActive}</Chip>}
        {!vm.planAutopayEnabled && vm.planAutopayDisabledReason && (
          <Chip tone="gold">
            {interp(t.autopayOff, { reason: autopayReasonLabel(vm.planAutopayDisabledReason, t) })}
          </Chip>
        )}
      </div>

      {vm.installments.length === 0 ? (
        <div style={{ marginTop: 14 }}>
          <EmptyState title={t.noPlan} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {vm.installments.map((inst) => {
            const c = chipFor(inst, t);
            const pendingZelle = pendingZelleOf(inst);
            return (
              <div
                key={inst.id}
                style={{
                  padding: "12px 14px",
                  border: "1px solid var(--line)",
                  borderRadius: 14,
                  background: "var(--panel-2)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>
                      {inst.isDownpayment ? t.downpaymentLabel : interp(t.installmentLabel, { n: String(inst.number) })}
                    </p>
                    {inst.dueDate && (
                      <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>
                        {new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-ES", { day: "numeric", month: "short", year: "numeric" }).format(new Date(inst.dueDate))}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 900, color: "var(--ink)" }}>{formatCents(inst.amountCents, locale)}</span>
                    <Chip tone={c.tone} dot>
                      {c.label}
                    </Chip>
                  </div>
                </div>

                {/* Pending Zelle proof → prominent verify affordance (RF-AND-011) */}
                {pendingZelle && canVerify && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 10px",
                      borderRadius: 10,
                      background: "var(--gold-soft)",
                    }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--gold-deep)" }}>
                      {t.zellePendingBadge}
                    </span>
                    <GhostBtn
                      size="md"
                      full={false}
                      onClick={() =>
                        setVerifyPayment({
                          id: pendingZelle.id,
                          amountCents: pendingZelle.amountCents,
                          createdAt: pendingZelle.createdAt,
                        })
                      }
                    >
                      {t.zelleVerifyBtn}
                    </GhostBtn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {downpaymentInstallment && canRegister && (
        <div style={{ marginTop: 16 }}>
          <GradientBtn size="md" full icon="dollar" onClick={() => setRegisterOpen(true)}>
            {interp(t.registerPayment, { amount: formatCents(vm.downpaymentAmountCents ?? 0, locale) })}
          </GradientBtn>
        </div>
      )}

      {/* Zelle proof verification (shared panel — billing-shared) */}
      {canVerify && (
        <ZelleVerifyPanel
          open={verifyPayment !== null}
          onClose={() => setVerifyPayment(null)}
          payment={
            verifyPayment
              ? { ...verifyPayment, statusLabel: t.zelleStatusPending }
              : null
          }
          onApprove={handleApprove}
          onReject={handleReject}
          onLoadProof={async (paymentId) => {
            const res = await actions.getZelleProofViewUrl!({ paymentId });
            return res.ok && res.url && res.kind ? { url: res.url, kind: res.kind } : null;
          }}
          strings={verifyStrings}
        />
      )}

      {/* Manual Zelle registration with mandatory proof (shared modal) */}
      {canRegister && (
        <ZelleRegisterModal
          open={registerOpen}
          onClose={() => setRegisterOpen(false)}
          installment={downpaymentInstallment}
          onGetUploadUrl={async (input) => {
            const res = await actions.getZelleProofUploadUrl!(input);
            return res.ok && res.signedUrl && res.path
              ? { signedUrl: res.signedUrl, path: res.path }
              : null;
          }}
          onConfirm={handleRegister}
          strings={registerStrings}
        />
      )}
    </Card>
  );
}
