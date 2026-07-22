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
import { Icon, type IconName } from "@/frontend/components/brand/icon";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { ProgressRing } from "@/frontend/components/brand/progress-ring";
import { toast } from "@/frontend/components/desktop/toast";
import { getBridge } from "@/frontend/platform-bridge";
import { ZelleRegisterModal } from "@/frontend/features/billing-shared";
import type { CaseWorkspaceVM, CaseDetailActions, CaseClientVM } from "../types";
import type { CasosStrings } from "../strings";
import { interp } from "../strings";
import { formatCents, SectionLabel } from "../ui";
import { buildZelleRegisterStrings } from "../zelle-strings";
import { PhaseStepper } from "../components/phase-stepper";
import { CaseHistory } from "../components/case-history";
import { AdvancePhaseAction } from "../components/advance-phase-action";
import { DEFAULT_PARTY_ROLE_LABELS, isPartyRoleKey } from "@/shared/constants/party-roles";

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

  // Phase boundary — Andrium (finance) / admin at the operations stage. Shown only
  // there; enabled once the expediente is printed (stage checklist complete). Reuses
  // advanceCasePhase: closes the phase → cycle restart at sales, or completes the case.
  const canAdvancePhase = !!actions.advanceCasePhase && vm.stage?.stage === "operations";

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
            {canAdvancePhase && (
              <div style={{ marginTop: 14 }}>
                <AdvancePhaseAction
                  caseId={vm.header.caseId}
                  advance={actions.advanceCasePhase!}
                  enabled={vm.stage?.allDone ?? false}
                  strings={{
                    button: t.advancePhaseButton,
                    blocked: t.advancePhaseBlocked,
                    confirmTitle: t.advancePhaseConfirmTitle,
                    confirmBody: t.advancePhaseConfirmBody,
                    ownerLabel: t.advancePhaseOwnerLabel,
                    ownerHint: t.advancePhaseOwnerHint,
                    selectOwner: t.advancePhaseSelectOwner,
                    cancel: t.advancePhaseCancel,
                    toastAdvanced: t.advancePhaseToastAdvanced,
                    toastCompleted: t.advancePhaseToastCompleted,
                    errorTitle: t.advancePhaseError,
                  }}
                />
              </div>
            )}
          </Card>
        )}

        <Card>
          <SectionLabel icon="user">{t.clientCardTitle}</SectionLabel>
          <ClientCard
            client={vm.client ?? null}
            caseId={vm.header.caseId}
            t={t}
            onEditAddress={actions.updateClientAddress}
          />
        </Card>

        <Card>
          <SectionLabel icon="family">{t.partiesTitle}</SectionLabel>
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
                  locale={locale}
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
  locale,
  onEdit,
}: {
  party: import("../types").PartyVM;
  caseId: string;
  t: CasosStrings["detail"];
  locale: "es" | "en";
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
        {party.role && (
          <span style={{ color: "var(--ink-3)" }}>
            {" · "}
            {isPartyRoleKey(party.role) ? DEFAULT_PARTY_ROLE_LABELS[party.role][locale] : party.role}
          </span>
        )}
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

type EditAddressFn = (input: {
  caseId: string;
  line1: string;
  apartment: string | null;
  city: string;
  state: string;
  zip: string;
}) => Promise<{ ok: boolean; error?: { code: string } }>;

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "9px 0",
  borderTop: "1px solid var(--line-2, var(--line))",
};

/**
 * "Datos del cliente" — the primary client's contact card (identity name +
 * email + phone + mailing address) captured at intake. Name/phone/email are
 * read-only identity; the address is editable inline when an edit action is
 * provided (admin + sales surfaces).
 */
function ClientCard({
  client,
  caseId,
  t,
  onEditAddress,
}: {
  client: CaseClientVM | null;
  caseId: string;
  t: CasosStrings["detail"];
  onEditAddress?: EditAddressFn;
}) {
  if (!client) {
    return (
      <p style={{ margin: "12px 0 0", color: "var(--ink-2)", fontSize: 14 }}>{t.notProvided}</p>
    );
  }
  const initial = (client.fullName ?? "?").charAt(0).toUpperCase();
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span aria-hidden="true" className="member-av">
          {initial}
        </span>
        <strong style={{ fontSize: 15, color: "var(--ink)", fontWeight: 800, wordBreak: "break-word" }}>
          {client.fullName ?? t.notProvided}
        </strong>
      </div>
      <ContactRow icon="mail" label={t.fieldEmail} value={client.email} t={t} />
      <ContactRow icon="phone" label={t.fieldPhone} value={client.phone} t={t} />
      <AddressBlock client={client} caseId={caseId} t={t} onEditAddress={onEditAddress} />
    </div>
  );
}

/** One read-only labeled contact row (icon + label above value). */
function ContactRow({
  icon,
  label,
  value,
  t,
}: {
  icon: IconName;
  label: string;
  value: string | null;
  t: CasosStrings["detail"];
}) {
  return (
    <div style={ROW_STYLE}>
      <Icon name={icon} size={17} color="var(--ink-3)" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>{label}</div>
        <div
          style={{
            fontSize: 14,
            color: value ? "var(--ink)" : "var(--ink-3)",
            fontWeight: 700,
            wordBreak: "break-word",
          }}
        >
          {value ?? t.notProvided}
        </div>
      </div>
    </div>
  );
}

/**
 * The mailing-address row of the client card. Read-only unless an edit action
 * is provided; editing swaps the value for inline inputs (line1/apartment/
 * city/state/zip). Mirrors PartyRow's inline-edit pattern (state + toast +
 * router.refresh). Name/phone/email are never editable here (identity).
 */
function AddressBlock({
  client,
  caseId,
  t,
  onEditAddress,
}: {
  client: CaseClientVM;
  caseId: string;
  t: CasosStrings["detail"];
  onEditAddress?: EditAddressFn;
}) {
  const router = useRouter();
  const addr = client.address;
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [line1, setLine1] = React.useState(addr?.line1 ?? "");
  const [apartment, setApartment] = React.useState(addr?.apartment ?? "");
  const [city, setCity] = React.useState(addr?.city ?? "");
  const [stateV, setStateV] = React.useState(addr?.state ?? "");
  const [zip, setZip] = React.useState(addr?.zip ?? "");

  function reset() {
    setLine1(addr?.line1 ?? "");
    setApartment(addr?.apartment ?? "");
    setCity(addr?.city ?? "");
    setStateV(addr?.state ?? "");
    setZip(addr?.zip ?? "");
  }

  const canSave = !!line1.trim() && !!city.trim() && !!stateV.trim() && !!zip.trim();

  async function save() {
    if (!onEditAddress || !canSave) return;
    setSaving(true);
    const res = await onEditAddress({
      caseId,
      line1: line1.trim(),
      apartment: apartment.trim() || null,
      city: city.trim(),
      state: stateV.trim(),
      zip: zip.trim(),
    });
    setSaving(false);
    if (res.ok) {
      toast.success(t.editAddressSaved);
      setEditing(false);
      router.refresh();
    } else {
      toast.error(t.editAddressError);
    }
  }

  const inputStyle: React.CSSProperties = {
    minWidth: 0,
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
      <div style={ROW_STYLE}>
        <Icon name="map" size={17} color="var(--ink-3)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600, marginBottom: 6 }}>
            {t.fieldAddress}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              value={line1}
              onChange={(e) => setLine1(e.target.value)}
              placeholder={t.addrLine1}
              aria-label={t.addrLine1}
              maxLength={120}
              style={{ ...inputStyle, width: "100%" }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={apartment}
                onChange={(e) => setApartment(e.target.value)}
                placeholder={t.addrApartment}
                aria-label={t.addrApartment}
                maxLength={40}
                style={{ ...inputStyle, flex: "1 1 90px" }}
              />
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder={t.addrCity}
                aria-label={t.addrCity}
                maxLength={80}
                style={{ ...inputStyle, flex: "2 1 130px" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={stateV}
                onChange={(e) => setStateV(e.target.value)}
                placeholder={t.addrState}
                aria-label={t.addrState}
                maxLength={40}
                style={{ ...inputStyle, flex: "1 1 70px" }}
              />
              <input
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder={t.addrZip}
                aria-label={t.addrZip}
                maxLength={12}
                style={{ ...inputStyle, flex: "1 1 90px" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                aria-label={t.editAddressSave}
                title={t.editAddressSave}
                disabled={saving || !canSave}
                onClick={save}
                style={{ ...miniBtn, opacity: saving || !canSave ? 0.45 : 1 }}
              >
                <Icon name="check" size={16} color="var(--accent)" />
              </button>
              <button
                type="button"
                aria-label={t.editAddressCancel}
                title={t.editAddressCancel}
                disabled={saving}
                onClick={() => {
                  reset();
                  setEditing(false);
                }}
                style={miniBtn}
              >
                <Icon name="x" size={16} color="var(--ink-3)" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const line1Text = addr?.line1 ?? "";
  const aptText = addr?.apartment ? `${line1Text ? " · " : ""}${t.apartmentPrefix} ${addr.apartment}` : "";
  const hasAddr = !!(addr && (addr.line1 || addr.cityStateZip || addr.city || addr.state || addr.zip));

  return (
    <div style={ROW_STYLE}>
      <Icon name="map" size={17} color="var(--ink-3)" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>{t.fieldAddress}</div>
        {hasAddr ? (
          <div style={{ fontSize: 14, color: "var(--ink)", fontWeight: 700, lineHeight: 1.4, wordBreak: "break-word" }}>
            <div>
              {line1Text}
              {aptText}
            </div>
            {addr?.cityStateZip && <div>{addr.cityStateZip}</div>}
          </div>
        ) : (
          <div style={{ fontSize: 14, color: "var(--ink-3)", fontWeight: 700 }}>{t.notProvided}</div>
        )}
      </div>
      {onEditAddress && (
        <button
          type="button"
          aria-label={t.editAddress}
          title={t.editAddress}
          onClick={() => {
            reset();
            setEditing(true);
          }}
          style={miniBtn}
        >
          <Icon name="edit" size={15} color="var(--ink-3)" />
        </button>
      )}
    </div>
  );
}
