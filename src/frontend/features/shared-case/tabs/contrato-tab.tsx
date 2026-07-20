"use client";

/**
 * Contrato tab (DOC-52 §5.4) — contract lifecycle. Left: 3-milestone timeline
 * (creado → enviado → firmado), service detail + payment plan. Right: state-
 * driven actions (enviar a firma / reenviar link / firmado).
 */

import * as React from "react";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { Icon } from "@/frontend/components/brand/icon";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { toast } from "@/frontend/components/desktop/toast";
import { getBridge } from "@/frontend/platform-bridge";
import type { CaseWorkspaceVM, CaseDetailActions } from "../types";
import type { CasosStrings } from "../strings";
import { interp, resolveCasosActionError } from "../strings";
import { formatCents, SectionLabel } from "../ui";

export function ContratoTab({
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
  const status = vm.header.contractStatus;
  const contractId = vm.header.contractId;
  const caseId = vm.header.caseId;
  const [busy, setBusy] = React.useState<"send" | "resend" | "copy" | "contract" | "consent" | null>(null);
  const [sent, setSent] = React.useState(status);

  async function onSend() {
    if (!contractId) return;
    setBusy("send");
    const res = await actions.sendContract({ contractId });
    setBusy(null);
    if (res.ok) {
      setSent("sent");
      toast.success(t.contractSentToast);
    } else toast.error(resolveCasosActionError(res.error?.code, strings));
  }

  async function onResend() {
    if (!contractId) return;
    setBusy("resend");
    const res = await actions.resendSigningLink({ contractId });
    setBusy(null);
    if (res.ok) toast.success(t.linkResent);
    else toast.error(resolveCasosActionError(res.error?.code, strings));
  }

  async function onCopyLink() {
    if (!contractId || !actions.getSigningLink) return;
    setBusy("copy");
    const res = await actions.getSigningLink({ contractId });
    setBusy(null);
    if (res.ok && res.url) {
      const copied = await getBridge().share.copyText(res.url);
      if (copied) toast.success(strings.copied);
      else toast.error(strings.errorTitle);
    } else toast.error(strings.errorTitle);
  }

  async function onDownloadContract() {
    if (!actions.downloadSignedContract) return;
    setBusy("contract");
    const res = await actions.downloadSignedContract({ caseId });
    setBusy(null);
    if (res.ok && res.url) getBridge().share.openExternal(res.url);
    else toast.error(strings.errorTitle);
  }

  async function onDownloadConsent() {
    if (!actions.getTermsAcceptance) return;
    setBusy("consent");
    const res = await actions.getTermsAcceptance({ caseId });
    setBusy(null);
    if (res.ok && res.url) getBridge().share.openExternal(res.url);
    else if (res.ok && !res.accepted) toast.error(t.consentPending);
    else toast.error(strings.errorTitle);
  }

  const eff = sent;
  const milestones = [
    { label: t.contractCreated, done: true },
    { label: t.contractSent, done: eff === "sent" || eff === "signed" },
    { label: t.contractSigned, done: eff === "signed" },
  ];

  return (
    <div className="grid2">
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <SectionLabel icon="doc">{t.contractTitle}</SectionLabel>
          <Chip tone={eff === "signed" ? "green" : eff === "sent" ? "gold" : "blue"} dot>
            {eff === "signed" ? t.contractSigned : eff === "sent" ? t.contractSent : t.contractDraft}
          </Chip>
        </div>

        {/* 3-milestone timeline */}
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 0 }}>
          {milestones.map((m, i) => (
            <div key={m.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    display: "grid",
                    placeItems: "center",
                    background: m.done ? "var(--brand-green)" : "var(--chip)",
                    border: m.done ? "none" : "2px solid var(--line)",
                  }}
                >
                  {m.done && <Icon name="check" size={15} color="#fff" />}
                </span>
                {i < milestones.length - 1 && (
                  <span style={{ width: 2, height: 22, background: m.done ? "var(--brand-green)" : "var(--line)", borderRadius: 99 }} />
                )}
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: m.done ? "var(--ink)" : "var(--ink-3)", paddingBottom: i < milestones.length - 1 ? 22 : 0 }}>
                {m.label}
              </span>
            </div>
          ))}
        </div>

        {/* Service detail */}
        <div style={{ marginTop: 18 }}>
          <SectionLabel icon="briefcase">{t.serviceDetail}</SectionLabel>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <Row label={t.serviceRow} value={vm.header.serviceLabel} />
            <Row label={t.planRow} value={vm.header.planKind === "with_lawyer" ? strings.planWith : strings.planSelf} />
          </div>
        </div>

        {/* Payment plan */}
        {vm.installments.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <SectionLabel icon="dollar">{t.paymentPlanTitle}</SectionLabel>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {vm.installments.map((inst) => (
                <div key={inst.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line-2, var(--line))" }}>
                  <span style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 700 }}>
                    {inst.isDownpayment ? t.downpaymentLabel : interp(t.installmentLabel, { n: String(inst.number) })}
                  </span>
                  <span style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 800 }}>{formatCents(inst.amountCents, locale)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Actions */}
      <Card>
        <SectionLabel icon="bolt">{t.contractActions}</SectionLabel>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {eff === "signed" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--green-soft)", borderRadius: 12, padding: "12px 14px" }}>
                <Icon name="check" size={18} color="var(--green)" />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--green)" }}>{t.contractSigned}</span>
              </div>
              {actions.downloadSignedContract && (
                <GradientBtn size="md" full icon="doc" disabled={busy === "contract"} onClick={onDownloadContract}>
                  {t.downloadContract}
                </GradientBtn>
              )}
              {actions.getTermsAcceptance && (
                <GhostBtn size="md" full icon="doc" disabled={busy === "consent"} onClick={onDownloadConsent}>
                  {t.downloadConsent}
                </GhostBtn>
              )}
            </>
          ) : eff === "sent" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--gold-soft)", borderRadius: 12, padding: "12px 14px" }}>
                <Icon name="clock" size={18} color="var(--gold-deep)" />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--gold-deep)" }}>{t.awaitingSignature}</span>
              </div>
              {contractId && actions.getSigningLink && (
                <GradientBtn size="md" full icon="copy" disabled={busy === "copy"} onClick={onCopyLink}>
                  {t.copySigningLink}
                </GradientBtn>
              )}
              {contractId && (
                <GhostBtn size="md" full icon="send" disabled={busy === "resend"} onClick={onResend}>
                  {t.resendLink}
                </GhostBtn>
              )}
            </>
          ) : contractId ? (
            <GradientBtn size="md" full icon="send" disabled={busy === "send"} onClick={onSend}>
              {busy === "send" ? t.sending : t.sendForSigning}
            </GradientBtn>
          ) : (
            <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 14 }}>—</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 13.5, color: "var(--ink-3)", fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 800, textAlign: "right" }}>{value}</span>
    </div>
  );
}
