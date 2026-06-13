"use client";

/**
 * Resumen tab (DOC-53 §3.4.1) — the F2-W2-b business gate lives here.
 *
 * Grid of cards: phase progress placeholder, payment status (with the manual
 * Zelle "register payment" action that activates the case), case parties, and
 * the latest timeline events. Also surfaces "Reenviar link de firma" when the
 * contract status is `sent`.
 */

import * as React from "react";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { Icon } from "@/frontend/components/brand/icon";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { toast } from "@/frontend/components/desktop/toast";
import type { CaseWorkspaceVM, CaseDetailActions } from "../types";
import type { CasosStrings } from "../strings";
import { interp } from "../strings";
import { formatCents, SectionLabel } from "../ui";

export function ResumenTab({
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
  const [busy, setBusy] = React.useState<"pay" | "resend" | null>(null);

  async function onRegisterPayment() {
    if (!vm.downpaymentInstallmentId) return;
    setBusy("pay");
    const res = await actions.registerPayment({ installmentId: vm.downpaymentInstallmentId });
    setBusy(null);
    if (res.ok) toast.success(t.paymentDone);
    else toast.error(strings.errorTitle);
  }

  async function onResend() {
    if (!vm.header.contractId) return;
    setBusy("resend");
    const res = await actions.resendSigningLink({ contractId: vm.header.contractId });
    setBusy(null);
    if (res.ok) toast.success(t.linkResent);
    else toast.error(strings.errorTitle);
  }

  const downAmount = vm.downpaymentAmountCents ?? 0;
  const canResend = vm.header.contractStatus === "sent" && vm.header.contractId;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        gap: 16,
      }}
    >
      {/* Payment status + manual Zelle gate */}
      <Card>
        <SectionLabel icon="dollar">{t.summaryPayment}</SectionLabel>
        {vm.installments.length === 0 ? (
          <p style={{ margin: "12px 0 0", color: "var(--ink-2)", fontSize: 14 }}>{t.noPlan}</p>
        ) : (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {vm.installments.map((inst) => {
              const paid = inst.status === "paid";
              return (
                <div
                  key={inst.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: "1px solid var(--line-2, var(--line))",
                  }}
                >
                  <span style={{ fontSize: 14, color: "var(--ink)", fontWeight: 700 }}>
                    {inst.isDownpayment
                      ? t.downpaymentLabel
                      : interp(t.installmentLabel, { n: String(inst.number) })}
                    <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>
                      {" · "}
                      {formatCents(inst.amountCents, locale)}
                    </span>
                  </span>
                  <Chip tone={paid ? "green" : "blue"} dot>
                    {paid ? t.paid : t.due}
                  </Chip>
                </div>
              );
            })}
          </div>
        )}

        {vm.downpaymentInstallmentId && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                background: "var(--gold-soft)",
                borderRadius: 12,
                padding: "10px 12px",
                marginBottom: 12,
              }}
            >
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--gold-deep)", fontWeight: 700 }}>
                {t.registerPaymentTitle}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-2)" }}>
                {t.registerPaymentBody}
              </p>
            </div>
            <GradientBtn
              size="md"
              full
              icon="dollar"
              disabled={busy === "pay"}
              onClick={onRegisterPayment}
            >
              {busy === "pay"
                ? t.registering
                : interp(t.registerPayment, { amount: formatCents(downAmount, locale) })}
            </GradientBtn>
          </div>
        )}

        {canResend && (
          <div style={{ marginTop: 12 }}>
            <GhostBtn size="md" full icon="send" disabled={busy === "resend"} onClick={onResend}>
              {t.resendLink}
            </GhostBtn>
          </div>
        )}
      </Card>

      {/* Parties */}
      <Card>
        <SectionLabel icon="user">{t.summaryParties}</SectionLabel>
        {vm.parties.length === 0 ? (
          <p style={{ margin: "12px 0 0", color: "var(--ink-2)", fontSize: 14 }}>{t.partiesEmpty}</p>
        ) : (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {vm.parties.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 999,
                    background: "linear-gradient(135deg, var(--accent), var(--navy))",
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    fontFamily: "var(--font-title)",
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                >
                  {p.name.charAt(0).toUpperCase()}
                </span>
                <span style={{ fontSize: 14, color: "var(--ink)" }}>
                  <strong style={{ fontWeight: 700 }}>{p.name}</strong>
                  {p.role && <span style={{ color: "var(--ink-3)" }}> · {p.role}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Timeline */}
      <Card style={{ gridColumn: "1 / -1" }}>
        <SectionLabel icon="clock">{t.summaryTimeline}</SectionLabel>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {vm.timeline.length === 0 ? (
            <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 14 }}>—</p>
          ) : (
            vm.timeline.map((ev) => (
              <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 999,
                    background: "var(--blue-soft)",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name="check" size={15} color="var(--accent)" />
                </span>
                <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{ev.title}</span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
