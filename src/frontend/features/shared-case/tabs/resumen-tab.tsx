"use client";

/**
 * Resumen tab (DOC-52 §5.3 / DOC-53 §3.4.1) — rebuilt to the UI Vanessa design.
 *
 * grid2: left = NBA (Lex) · Ruta de citas (phase stepper) · Datos clave (parties);
 * right = Progreso (docs/forms rings) · Estado de pago (manual Zelle gate — the
 * F2 business gate that activates the case) · Historial reciente.
 */

import * as React from "react";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { Icon } from "@/frontend/components/brand/icon";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { ProgressRing } from "@/frontend/components/brand/progress-ring";
import { toast } from "@/frontend/components/desktop/toast";
import type { CaseWorkspaceVM, CaseDetailActions } from "../types";
import type { CasosStrings } from "../strings";
import { interp } from "../strings";
import { formatCents, SectionLabel } from "../ui";
import { PhaseStepper } from "../components/phase-stepper";
import { CaseHistory } from "../components/case-history";

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
  const canResend = vm.header.contractStatus === "sent" && !!vm.header.contractId;
  const docsPct = vm.docsTotal > 0 ? Math.round((vm.docsApproved / vm.docsTotal) * 100) : 0;
  const formsPct = vm.formsTotal > 0 ? Math.round((vm.formsDone / vm.formsTotal) * 100) : 0;

  return (
    <div className="grid2">
      {/* Left column */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="nba">
          <Icon name="sparkle" size={28} color="#fff" />
          <div>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 12, letterSpacing: ".04em", textTransform: "uppercase", opacity: 0.85 }}>
              {t.nbaTitle}
            </p>
            <p style={{ margin: "3px 0 0", fontWeight: 700, fontSize: 14.5, lineHeight: 1.4 }}>{t.nbaDefault}</p>
          </div>
        </div>

        {vm.header.phaseCount > 0 && (
          <Card>
            <SectionLabel icon="route">{t.routeTitle}</SectionLabel>
            <div style={{ marginTop: 16, overflowX: "auto", paddingBottom: 4 }}>
              <PhaseStepper
                index={vm.header.phaseIndex}
                count={vm.header.phaseCount}
                currentLabel={vm.header.phaseLabel}
                phaseWord={strings.colPhase}
              />
            </div>
          </Card>
        )}

        <Card>
          <SectionLabel icon="user">{t.keyData}</SectionLabel>
          {vm.parties.length === 0 ? (
            <p style={{ margin: "12px 0 0", color: "var(--ink-2)", fontSize: 14 }}>{t.partiesEmpty}</p>
          ) : (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {vm.parties.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span aria-hidden="true" className="member-av">
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
      </div>

      {/* Right column */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card>
          <SectionLabel icon="grid">{t.progressTitle}</SectionLabel>
          <div style={{ marginTop: 16, display: "flex", gap: 28, justifyContent: "center", flexWrap: "wrap" }}>
            <ProgressRing pct={docsPct} size={92} sub={t.progressDocs} aria-label={t.progressDocs} />
            <ProgressRing pct={formsPct} size={92} sub={t.progressForms} aria-label={t.progressForms} />
          </div>
        </Card>

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
                      {inst.isDownpayment ? t.downpaymentLabel : interp(t.installmentLabel, { n: String(inst.number) })}
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
              <div style={{ background: "var(--gold-soft)", borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--gold-deep)", fontWeight: 700 }}>{t.registerPaymentTitle}</p>
                <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-2)" }}>{t.registerPaymentBody}</p>
              </div>
              <GradientBtn size="md" full icon="dollar" disabled={busy === "pay"} onClick={onRegisterPayment}>
                {busy === "pay" ? t.registering : interp(t.registerPayment, { amount: formatCents(downAmount, locale) })}
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

        <Card>
          <SectionLabel icon="clock">{t.recentHistory}</SectionLabel>
          <div style={{ marginTop: 14 }}>
            {vm.timeline.length === 0 ? (
              <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 14 }}>—</p>
            ) : (
              <CaseHistory events={vm.timeline.slice(0, 6)} locale={locale} />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
