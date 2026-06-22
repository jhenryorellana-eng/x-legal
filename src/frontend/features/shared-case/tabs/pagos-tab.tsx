"use client";

/**
 * Pagos tab (DOC-53 §3.4 — billing) — account statement (installments) with the
 * manual Zelle downpayment gate. Full staff actions (waive / reschedule) land in
 * a later wave.
 */

import * as React from "react";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { toast } from "@/frontend/components/desktop/toast";
import type { CaseWorkspaceVM, CaseDetailActions, InstallmentVM } from "../types";
import type { CasosStrings } from "../strings";
import { interp } from "../strings";
import { formatCents, SectionLabel } from "../ui";

function chipFor(inst: InstallmentVM, t: CasosStrings["detail"]): { tone: "green" | "blue" | "amber" | "gold"; label: string } {
  switch (inst.status) {
    case "paid":
      return { tone: "green", label: t.paid };
    case "overdue":
      return { tone: "amber", label: t.overdue };
    case "scheduled":
      return { tone: "blue", label: t.scheduled };
    case "waived":
      return { tone: "gold", label: t.waived };
    default:
      return { tone: "blue", label: t.due };
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
  const [busy, setBusy] = React.useState(false);

  async function onRegisterPayment() {
    if (!vm.downpaymentInstallmentId) return;
    setBusy(true);
    const res = await actions.registerPayment({ installmentId: vm.downpaymentInstallmentId });
    setBusy(false);
    if (res.ok) toast.success(t.paymentDone);
    else toast.error(strings.errorTitle);
  }

  return (
    <Card>
      <SectionLabel icon="wallet">{t.pagosTitle}</SectionLabel>

      {vm.installments.length === 0 ? (
        <div style={{ marginTop: 14 }}>
          <EmptyState title={t.noPlan} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {vm.installments.map((inst) => {
            const c = chipFor(inst, t);
            return (
              <div
                key={inst.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 14px",
                  border: "1px solid var(--line)",
                  borderRadius: 14,
                  background: "var(--panel-2)",
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
            );
          })}
        </div>
      )}

      {vm.downpaymentInstallmentId && (
        <div style={{ marginTop: 16 }}>
          <GradientBtn size="md" full icon="dollar" disabled={busy} onClick={onRegisterPayment}>
            {busy ? t.registering : interp(t.registerPayment, { amount: formatCents(vm.downpaymentAmountCents ?? 0, locale) })}
          </GradientBtn>
        </div>
      )}
    </Card>
  );
}
