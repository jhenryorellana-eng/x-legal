"use client";

/**
 * Resumen tab (DOC-52 §5.3 / DOC-53 §3.4.1) — rebuilt to the UI Vanessa design.
 *
 * grid2: left = NBA (Lex) · Ruta de citas (phase stepper) · Datos clave (parties);
 * right = Progreso (docs/forms rings) · Estado de pago (manual Zelle gate — the
 * F2 business gate that activates the case) · Historial reciente.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { Icon } from "@/frontend/components/brand/icon";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { ProgressRing } from "@/frontend/components/brand/progress-ring";
import { toast } from "@/frontend/components/desktop/toast";
import { getBridge } from "@/frontend/platform-bridge";
import { ZelleRegisterModal } from "@/frontend/features/billing-shared";
import type { CaseWorkspaceVM, CaseDetailActions } from "../types";
import type { CasosStrings } from "../strings";
import { interp } from "../strings";
import { formatCents, SectionLabel } from "../ui";
import { buildZelleRegisterStrings } from "../zelle-strings";
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
  const router = useRouter();
  const [busy, setBusy] = React.useState<"pay" | "resend" | "phase" | "contract" | "consent" | null>(null);
  const editPartyAction = vm.isAdmin ? actions.updateCaseParty : undefined;

  // Manual milestone advance (admin/paralegal). Milestones are the progression
  // unit; advancing crosses phases automatically. Shown whenever the case has a
  // configured service — the backend rejects once the last milestone is reached.
  const canAdvance = !!actions.advanceCaseMilestone && vm.header.phaseCount > 0;

  async function onAdvanceMilestone() {
    if (!actions.advanceCaseMilestone) return;
    setBusy("phase");
    const res = await actions.advanceCaseMilestone({ caseId: vm.header.caseId });
    setBusy(null);
    if (res.ok) {
      toast.success(t.advanceMilestoneDone);
      router.refresh();
    } else if (res.error?.code === "CASE_ALREADY_LAST_MILESTONE") {
      toast.error(t.advanceMilestoneLast);
    } else {
      toast.error(strings.errorTitle);
    }
  }

  // Manual Zelle registration requires the proof upload (Henry 2026-07-02) —
  // the button opens the shared modal; only payment-operating roles see it.
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const canRegister =
    (vm.isAdmin || vm.role === "sales" || vm.role === "finance") &&
    !!actions.getZelleProofUploadUrl;

  async function onRegisterConfirm(input: {
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

  async function onResend() {
    if (!vm.header.contractId) return;
    setBusy("resend");
    const res = await actions.resendSigningLink({ contractId: vm.header.contractId });
    setBusy(null);
    if (res.ok) toast.success(t.linkResent);
    else toast.error(strings.errorTitle);
  }

  async function onDownloadContract() {
    if (!actions.downloadSignedContract) return;
    setBusy("contract");
    const res = await actions.downloadSignedContract({ caseId: vm.header.caseId });
    setBusy(null);
    if (res.ok && res.url) getBridge().share.openExternal(res.url);
    else toast.error(strings.errorTitle);
  }

  async function onDownloadConsent() {
    if (!actions.getTermsAcceptance) return;
    setBusy("consent");
    const res = await actions.getTermsAcceptance({ caseId: vm.header.caseId });
    setBusy(null);
    if (res.ok && res.url) getBridge().share.openExternal(res.url);
    else if (res.ok && !res.accepted) toast.error(t.consentPending);
    else toast.error(strings.errorTitle);
  }

  const downAmount = vm.downpaymentAmountCents ?? 0;
  const canResend = vm.header.contractStatus === "sent" && !!vm.header.contractId;
  const canDownloadContract =
    vm.header.contractStatus === "signed" && !!actions.downloadSignedContract;
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
            {canAdvance && (
              <div style={{ marginTop: 14 }}>
                <GradientBtn
                  size="md"
                  full
                  icon="chevR"
                  disabled={busy === "phase"}
                  onClick={onAdvanceMilestone}
                >
                  {busy === "phase" ? t.advancingMilestone : t.advanceMilestone}
                </GradientBtn>
              </div>
            )}
          </Card>
        )}

        <Card>
          <SectionLabel icon="user">{t.keyData}</SectionLabel>
          {vm.parties.length === 0 ? (
            <p style={{ margin: "12px 0 0", color: "var(--ink-2)", fontSize: 14 }}>{t.partiesEmpty}</p>
          ) : (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {vm.parties.map((p) => (
                <PartyRow
                  key={p.id}
                  party={p}
                  caseId={vm.header.caseId}
                  t={t}
                  onEdit={editPartyAction}
                />
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

          {vm.downpaymentInstallmentId && canRegister && (
            <div style={{ marginTop: 16 }}>
              <div style={{ background: "var(--gold-soft)", borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--gold-deep)", fontWeight: 700 }}>{t.registerPaymentTitle}</p>
                <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-2)" }}>{t.registerPaymentBody}</p>
              </div>
              <GradientBtn size="md" full icon="dollar" onClick={() => setRegisterOpen(true)}>
                {interp(t.registerPayment, { amount: formatCents(downAmount, locale) })}
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

          {canDownloadContract && (
            <div style={{ marginTop: 12 }}>
              <GhostBtn size="md" full icon="doc" disabled={busy === "contract"} onClick={onDownloadContract}>
                {t.downloadContract}
              </GhostBtn>
            </div>
          )}

          {actions.getTermsAcceptance && (
            <div style={{ marginTop: 12 }}>
              <GhostBtn size="md" full icon="doc" disabled={busy === "consent"} onClick={onDownloadConsent}>
                {t.downloadConsent}
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

      {/* Manual Zelle registration — mandatory proof (billing-shared modal) */}
      {canRegister && vm.downpaymentInstallmentId && (
        <ZelleRegisterModal
          open={registerOpen}
          onClose={() => setRegisterOpen(false)}
          installment={{ id: vm.downpaymentInstallmentId, amountCents: downAmount }}
          onGetUploadUrl={async (input) => {
            const res = await actions.getZelleProofUploadUrl!(input);
            return res.ok && res.signedUrl && res.path
              ? { signedUrl: res.signedUrl, path: res.path }
              : null;
          }}
          onConfirm={onRegisterConfirm}
          strings={buildZelleRegisterStrings(t)}
        />
      )}
    </div>
  );
}

/**
 * One party row in "Datos clave". Read-only by default; when an edit action is
 * provided (admin surface), shows a pencil that opens inline first/last inputs.
 */
function PartyRow({
  party,
  caseId,
  t,
  onEdit,
}: {
  party: import("../types").PartyVM;
  caseId: string;
  t: CasosStrings["detail"];
  onEdit?: (input: {
    caseId: string;
    partyId: string;
    firstName: string;
    lastName: string;
  }) => Promise<{ ok: boolean; resynced?: boolean; error?: { code: string } }>;
}) {
  const router = useRouter();
  const split = party.name.trim().split(/\s+/);
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [first, setFirst] = React.useState(party.firstName ?? split[0] ?? "");
  const [last, setLast] = React.useState(party.lastName ?? split.slice(1).join(" "));

  async function save() {
    if (!onEdit || !first.trim()) return;
    setSaving(true);
    const res = await onEdit({ caseId, partyId: party.id, firstName: first.trim(), lastName: last.trim() });
    setSaving(false);
    if (res.ok) {
      toast.success(t.editPartySaved);
      setEditing(false);
      router.refresh();
    } else {
      toast.error(res.error?.code === "CASE_CONTRACT_LOCKED" ? t.editPartyLocked : t.editPartyError);
    }
  }

  function cancel() {
    setFirst(party.firstName ?? split[0] ?? "");
    setLast(party.lastName ?? split.slice(1).join(" "));
    setEditing(false);
  }

  const inputStyle: React.CSSProperties = {
    flex: "1 1 110px",
    minWidth: 90,
    height: 36,
    borderRadius: 9,
    border: "1px solid var(--line)",
    padding: "0 10px",
    fontSize: 14,
    color: "var(--ink)",
    background: "var(--card)",
  };
  const miniBtn: React.CSSProperties = {
    height: 36,
    width: 36,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    border: "1px solid var(--line)",
    background: "var(--card)",
    cursor: "pointer",
  };

  if (editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          placeholder={t.editPartyFirst}
          aria-label={t.editPartyFirst}
          maxLength={80}
          style={inputStyle}
        />
        <input
          value={last}
          onChange={(e) => setLast(e.target.value)}
          placeholder={t.editPartyLast}
          aria-label={t.editPartyLast}
          maxLength={80}
          style={inputStyle}
        />
        <button
          type="button"
          aria-label={t.editPartySave}
          title={t.editPartySave}
          disabled={saving || !first.trim()}
          onClick={save}
          style={{ ...miniBtn, opacity: saving || !first.trim() ? 0.45 : 1 }}
        >
          <Icon name="check" size={16} color="var(--accent)" />
        </button>
        <button
          type="button"
          aria-label={t.editPartyCancel}
          title={t.editPartyCancel}
          disabled={saving}
          onClick={cancel}
          style={miniBtn}
        >
          <Icon name="x" size={16} color="var(--ink-3)" />
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span aria-hidden="true" className="member-av">
        {party.name.charAt(0).toUpperCase()}
      </span>
      <span style={{ fontSize: 14, color: "var(--ink)", flex: 1 }}>
        <strong style={{ fontWeight: 700 }}>{party.name}</strong>
        {party.role && <span style={{ color: "var(--ink-3)" }}> · {party.role}</span>}
      </span>
      {onEdit && (
        <button
          type="button"
          aria-label={t.editParty}
          title={t.editParty}
          onClick={() => setEditing(true)}
          style={miniBtn}
        >
          <Icon name="edit" size={15} color="var(--ink-3)" />
        </button>
      )}
    </div>
  );
}
