"use client";

/**
 * "Nuevo caso" — wizard modal (DOC-53 §3, resolución H-2 + RF-VAN-018).
 *
 * Step 1 — "¿Para quién es el caso?" (RF-VAN-018), two modes:
 *           · Existing client: debounced picker (name/phone/email search, shows
 *             case count) → selecting prefills the fields below. Name, phone
 *             and email are READ-ONLY (identity: the phone is the login
 *             credential — one account per client); only the ADDRESS stays
 *             editable and is persisted to the profile on submit.
 *           · New client: full name + email + US phone + full US address
 *             (street, apartment, city, state, ZIP). All required except apartment.
 * Step 2 — Service + plan + parties. Shows the non-blocking RF-VAN-019 notice
 *          when the picked client already has a case of the chosen service.
 * Step 3 — Payment plan. Step 4 — signing link to copy/send.
 *
 * Phone-only login (DOC-22 §1, June 2026): clientPhone is the client's login
 * credential (they sign in with just their phone — no OTP yet). clientEmail is
 * kept as contact info + the internal Supabase Auth identity. The address is
 * required too — it prefills the I-589 via client_profiles.address
 * (resolveBySource('profile')).
 */

import * as React from "react";
import { getBridge } from "@/frontend/platform-bridge";
import { Modal } from "@/frontend/components/desktop/modal";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { Icon } from "@/frontend/components/brand/icon";
import { Chip } from "@/frontend/components/brand/chip";
import { toast } from "@/frontend/components/desktop/toast";
import type { CasosStrings } from "@/frontend/features/shared-case";

export interface NewCasePlan {
  kind: "self" | "with_lawyer";
  label: string;
  priceCents: number;
  downpaymentCents: number | null;
  installments: number;
  /** Catalog default cadence — seeds the editable selector (Henry 2026-07-03). */
  frequency: "weekly" | "monthly";
}

/** An additional case party a service declares (besides the applicant). */
export interface NewCasePartyRole {
  roleKey: string;
  label: string;
  cardinality: "single" | "multiple";
  required: boolean;
}

export interface NewCaseService {
  id: string;
  label: string;
  plans: NewCasePlan[];
  /** Per-plan-kind encoded resolution string the create action decodes. */
  encodedByKind: Record<string, string>;
  /** Additional case parties this service declares (the applicant is implicit). */
  partyRoles: NewCasePartyRole[];
}

/** Existing client returned by the step-1 picker search (RF-VAN-018). */
export interface ClientPick {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: { line1: string; city: string; state: string; zip: string; apartment?: string } | null;
  /** Cases where this client is the primary — shown as "N casos" in the row. */
  caseCount: number;
}

/** Existing case of the picked client — powers the RF-VAN-019 dup notice. */
export interface ExistingCaseSummary {
  caseId: string;
  caseNumber: string;
  serviceId: string;
  serviceLabel: string;
}

export interface NewCaseInput {
  clientName: string;
  /** Login credential (DOC-22 §1, email auth). */
  clientEmail: string;
  /** Login credential (DOC-22 §1) — required: phone + email together. */
  clientPhone: string;
  /** Full US mailing address — required (prefills the I-589 via profile). */
  clientAddress: {
    line1: string;
    city: string;
    state: string;
    zip: string;
    apartment?: string;
  };
  /** Encoded plan resolution string: serviceId|planId|price|down|installments. */
  serviceId: string;
  planKind: "self" | "with_lawyer";
  parties: { name: string; role: string }[];
  /**
   * Per-contract payment plan override (price/downpayment/installments + note).
   * Defaults come from the service plan but Vanessa/Henry can adjust them here so
   * the contract is correct and immutable from the start (e.g. a promo price).
   */
  paymentPlan: {
    totalCents: number;
    downpaymentCents: number;
    installmentCount: number;
    frequency: "weekly" | "monthly";
    note?: string;
  };
  /** Originating lead id when launched from a lead card — links leads.won_case_id. */
  leadId?: string;
  /**
   * Set when the operator picked an EXISTING client (RF-VAN-018): the backend
   * skips provisioning and persists the step-1 edits to the client profile.
   */
  existingClientId?: string;
}

export interface NewCaseActions {
  createCase: (
    input: NewCaseInput,
  ) => Promise<{
    ok: boolean;
    signingToken?: string;
    /** Absolute, ready-to-share signing link built server-side (canonical origin). */
    signingUrl?: string;
    error?: { code: string; message?: string };
  }>;
  /** Step-1 picker search (RF-VAN-018) — empty query returns recent clients. */
  searchClients: (
    query: string,
  ) => Promise<{ ok: boolean; results?: ClientPick[]; error?: { code: string; message?: string } }>;
  /** Cases of the picked client — feeds the RF-VAN-019 duplicate-service notice. */
  getClientCases: (
    clientId: string,
  ) => Promise<{ ok: boolean; cases?: ExistingCaseSummary[]; error?: { code: string; message?: string } }>;
}

export function NewCaseModal({
  open,
  onOpenChange,
  services,
  strings,
  actions,
  leadId,
  presetName,
  presetPhone,
  caseLinkBase,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  services: NewCaseService[];
  strings: CasosStrings;
  actions: NewCaseActions;
  /** When the modal is opened from a lead card, links the case back to the lead. */
  leadId?: string;
  /** Prefill step 1 from the originating lead (name/phone the lead already has). */
  presetName?: string | null;
  presetPhone?: string | null;
  /** Base path for the "Ver" link of the RF-VAN-019 notice (e.g. "/ventas/clientes"). */
  caseLinkBase?: string;
}) {
  // `actions` is rebuilt inline by the parent each render; pin to a ref so the
  // debounced search effect depends on stable values, not the object identity.
  const actionsRef = React.useRef(actions);
  actionsRef.current = actions;
  const [step, setStep] = React.useState<1 | 2 | 3 | 4>(1);
  // Step 1 mode (RF-VAN-018): pick an existing client (default) or create new.
  const [clientMode, setClientMode] = React.useState<"existing" | "new">("existing");
  const [clientQuery, setClientQuery] = React.useState("");
  const [clientResults, setClientResults] = React.useState<ClientPick[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [selectedClient, setSelectedClient] = React.useState<ClientPick | null>(null);
  const [existingCases, setExistingCases] = React.useState<ExistingCaseSummary[]>([]);
  const [name, setName] = React.useState("");
  const [clientEmail, setClientEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [line1, setLine1] = React.useState("");
  const [apartment, setApartment] = React.useState("");
  const [city, setCity] = React.useState("");
  const [stateCode, setStateCode] = React.useState("");
  const [zip, setZip] = React.useState("");
  const [serviceId, setServiceId] = React.useState("");
  const [planKind, setPlanKind] = React.useState<"self" | "with_lawyer" | "">("");
  // Editable payment plan (dollars as strings for the inputs; default-seeded from
  // the chosen plan, then overridable for a promo/discount before freezing).
  const [priceDollars, setPriceDollars] = React.useState("");
  const [downDollars, setDownDollars] = React.useState("");
  const [installmentsCount, setInstallmentsCount] = React.useState("");
  const [frequency, setFrequency] = React.useState<"weekly" | "monthly">("monthly");
  const [discountNote, setDiscountNote] = React.useState("");
  // Additional parties keyed by the service's role_key → list of names. The
  // applicant is implicit (auto-added by the backend), so it is NOT here.
  const [partyNames, setPartyNames] = React.useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [signingLink, setSigningLink] = React.useState<string | null>(null);

  // Prefill client name/phone from the originating lead each time the modal
  // opens (e.g. dragging a lead to the terminal-won column). Only seeds on the
  // open transition so it never clobbers what the operator is typing. The lead
  // data also seeds the picker query so a returning client is found instead of
  // duplicated (RF-VAN-018/019 intent).
  React.useEffect(() => {
    if (!open) return;
    if (presetName) setName(presetName);
    if (presetPhone) setPhone(presetPhone);
    const preset = presetPhone ?? presetName;
    if (preset) setClientQuery(preset);
  }, [open, presetName, presetPhone]);

  // Debounced picker search (250ms) while in existing mode with no selection.
  // Empty query is allowed — the backend returns the most recent clients.
  React.useEffect(() => {
    if (!open || clientMode !== "existing" || selectedClient) return;
    let active = true;
    setSearching(true);
    const handle = setTimeout(async () => {
      const res = await actionsRef.current.searchClients(clientQuery);
      if (!active) return;
      setClientResults(res.ok && res.results ? res.results : []);
      setSearching(false);
    }, 250);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [open, clientMode, selectedClient, clientQuery]);

  /** Picks an existing client: prefills every step-1 field (defensively — older
   *  profiles may lack an address) and loads their cases for the dup notice. */
  function selectClient(c: ClientPick) {
    setSelectedClient(c);
    setName(c.name ?? "");
    setClientEmail(c.email ?? "");
    setPhone(c.phone ?? "");
    setLine1(c.address?.line1 ?? "");
    setApartment(c.address?.apartment ?? "");
    setCity(c.address?.city ?? "");
    setStateCode(c.address?.state ?? "");
    setZip(c.address?.zip ?? "");
    setExistingCases([]);
    void actionsRef.current.getClientCases(c.userId).then((res) => {
      setExistingCases(res.ok && res.cases ? res.cases : []);
    });
  }

  /** "Cambiar" — back to the picker keeping the query/results context. */
  function clearSelectedClient() {
    setSelectedClient(null);
    setExistingCases([]);
  }

  /** Switching modes resets the selection and the step-1 fields, re-seeding the
   *  lead preset so the "new" form starts from the lead data again. */
  function switchClientMode(m: "existing" | "new") {
    if (m === clientMode) return;
    setClientMode(m);
    setSelectedClient(null);
    setExistingCases([]);
    setClientResults([]);
    setName(presetName ?? "");
    setClientEmail("");
    setPhone(presetPhone ?? "");
    setLine1("");
    setApartment("");
    setCity("");
    setStateCode("");
    setZip("");
    if (m === "existing") setClientQuery(presetPhone ?? presetName ?? "");
  }

  const service = services.find((s) => s.id === serviceId);

  /** Seeds one empty name slot per additional role of the chosen service. */
  function selectService(id: string) {
    setServiceId(id);
    setPlanKind("");
    const svc = services.find((s) => s.id === id);
    const init: Record<string, string[]> = {};
    for (const r of svc?.partyRoles ?? []) init[r.roleKey] = [""];
    setPartyNames(init);
  }

  /** Selects a plan and seeds the editable payment fields from its defaults. */
  function selectPlan(p: NewCasePlan) {
    setPlanKind(p.kind);
    setPriceDollars(centsToInput(p.priceCents));
    setDownDollars(centsToInput(p.downpaymentCents ?? 0));
    setInstallmentsCount(String(p.installments || 1));
    setFrequency(p.frequency ?? "monthly");
    setDiscountNote("");
  }

  function setPartyName(roleKey: string, idx: number, value: string) {
    setPartyNames((prev) => {
      const list = [...(prev[roleKey] ?? [""])];
      list[idx] = value;
      return { ...prev, [roleKey]: list };
    });
  }
  function addPartySlot(roleKey: string) {
    setPartyNames((prev) => ({ ...prev, [roleKey]: [...(prev[roleKey] ?? []), ""] }));
  }
  function removePartySlot(roleKey: string, idx: number) {
    setPartyNames((prev) => ({
      ...prev,
      [roleKey]: (prev[roleKey] ?? []).filter((_, i) => i !== idx),
    }));
  }

  function reset() {
    setStep(1);
    setClientMode("existing");
    setClientQuery("");
    setClientResults([]);
    setSelectedClient(null);
    setExistingCases([]);
    setName("");
    setClientEmail("");
    setPhone("");
    setLine1("");
    setApartment("");
    setCity("");
    setStateCode("");
    setZip("");
    setServiceId("");
    setPlanKind("");
    setPriceDollars("");
    setDownDollars("");
    setInstallmentsCount("");
    setFrequency("monthly");
    setDiscountNote("");
    setPartyNames({});
    setSigningLink(null);
  }

  function close(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail.trim());
  // Phone + full US address (apartment optional) are now mandatory — both phone
  // and email are login credentials, and the address prefills the I-589.
  const phoneValid = phone.replace(/\D/g, "").length >= 10;
  const addressValid =
    line1.trim().length > 2 && city.trim().length > 1 && stateCode.trim().length >= 2 && zip.trim().length >= 5;
  // Existing mode: a picked client is mandatory (RF-VAN-018 — "Siguiente" only
  // enables with a selection). Identity fields (name/phone/email) come from
  // the profile read-only, so only the editable address is validated here.
  const step1Valid =
    clientMode === "existing"
      ? !!selectedClient && addressValid
      : name.trim().length > 1 && emailValid && phoneValid && addressValid;
  // Every REQUIRED additional role must have at least one named party.
  const rolesValid = (service?.partyRoles ?? []).every(
    (r) => !r.required || (partyNames[r.roleKey] ?? []).some((n) => n.trim()),
  );
  const step2Valid = !!serviceId && !!planKind && rolesValid;

  // Editable payment plan (parsed from the dollar inputs). Downpayment must be
  // > 0 and ≤ total; installments ≥ 1 (matches the backend contract).
  const priceCents = parseDollarsToCents(priceDollars);
  const downCents = parseDollarsToCents(downDollars);
  const instCount = Number.parseInt(installmentsCount, 10);
  const paymentValid =
    Number.isFinite(priceCents) && priceCents > 0 &&
    Number.isFinite(downCents) && downCents > 0 && downCents <= priceCents &&
    Number.isInteger(instCount) && instCount >= 1;
  // Monthly preview: balance after downpayment spread over the remaining cuotas.
  const monthlyCount = instCount > 1 ? instCount - 1 : 0;
  const monthlyCents = monthlyCount > 0 ? Math.round((priceCents - downCents) / monthlyCount) : 0;

  // RF-VAN-019: the picked client already holds a case of the chosen service.
  // Informative only — a client may legitimately have N cases of one service.
  const dupCase =
    clientMode === "existing" && selectedClient
      ? existingCases.find((c) => c.serviceId === serviceId)
      : undefined;

  async function submit() {
    if (!step2Valid || !paymentValid) return;
    setSubmitting(true);
    const encoded = service?.encodedByKind[planKind] ?? serviceId;
    // Additional parties only — the applicant is auto-added by the backend.
    const parties = (service?.partyRoles ?? []).flatMap((r) =>
      (partyNames[r.roleKey] ?? [])
        .filter((n) => n.trim())
        .map((n) => ({ name: n.trim(), role: r.roleKey })),
    );
    const res = await actions.createCase({
      clientName: name.trim(),
      clientEmail: clientEmail.trim(),
      clientPhone: phone.trim(),
      clientAddress: {
        line1: line1.trim(),
        city: city.trim(),
        state: stateCode.trim(),
        zip: zip.trim(),
        ...(apartment.trim() ? { apartment: apartment.trim() } : {}),
      },
      serviceId: encoded,
      planKind: planKind as "self" | "with_lawyer",
      parties,
      paymentPlan: {
        totalCents: priceCents,
        downpaymentCents: downCents,
        installmentCount: instCount,
        frequency,
        note: discountNote.trim() || undefined,
      },
      ...(leadId ? { leadId } : {}),
      ...(clientMode === "existing" && selectedClient
        ? { existingClientId: selectedClient.userId }
        : {}),
    });
    setSubmitting(false);
    if (res.ok && res.signingUrl) {
      // Absolute link built server-side (canonical origin) — copyable/shareable.
      setSigningLink(res.signingUrl);
      setStep(4);
    } else {
      toast.error(res.error?.message ?? strings.errorTitle);
    }
  }

  async function copyLink() {
    if (!signingLink) return;
    const ok = await getBridge().share.copyText(signingLink);
    if (ok) toast.success(strings.copied);
    else toast.error(strings.errorTitle);
  }

  const title =
    step === 1
      ? strings.newCaseStep1
      : step === 2
        ? strings.newCaseStep2
        : step === 3
          ? strings.newCaseStep3
          : strings.linkTitle;

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={title}
      width={560}
      footer={
        step === 4 ? (
          <GradientBtn size="md" full={false} icon="check" onClick={() => close(false)}>
            {strings.done}
          </GradientBtn>
        ) : step === 1 ? (
          <>
            <GhostBtn size="md" full={false} onClick={() => close(false)}>
              {strings.cancel}
            </GhostBtn>
            <GradientBtn
              size="md"
              full={false}
              icon="chevR"
              disabled={!step1Valid}
              onClick={() => setStep(2)}
            >
              {strings.next}
            </GradientBtn>
          </>
        ) : step === 2 ? (
          <>
            <GhostBtn size="md" full={false} icon="chevL" onClick={() => setStep(1)}>
              {strings.back}
            </GhostBtn>
            <GradientBtn
              size="md"
              full={false}
              icon="chevR"
              disabled={!step2Valid}
              onClick={() => setStep(3)}
            >
              {strings.next}
            </GradientBtn>
          </>
        ) : (
          <>
            <GhostBtn size="md" full={false} icon="chevL" onClick={() => setStep(2)}>
              {strings.back}
            </GhostBtn>
            <GradientBtn
              size="md"
              full={false}
              icon="lock"
              disabled={!paymentValid || submitting}
              onClick={submit}
            >
              {submitting ? strings.creating : strings.createCase}
            </GradientBtn>
          </>
        )
      }
    >
      {/* Step indicator */}
      {step !== 4 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 999,
                background: step >= n ? "var(--accent)" : "var(--line)",
              }}
            />
          ))}
        </div>
      )}

      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Mode selector — Cliente existente | Cliente nuevo (RF-VAN-018) */}
          <div style={segmentedStyle} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={clientMode === "existing"}
              onClick={() => switchClientMode("existing")}
              style={segBtnStyle(clientMode === "existing")}
            >
              {strings.modeExisting}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={clientMode === "new"}
              onClick={() => switchClientMode("new")}
              style={segBtnStyle(clientMode === "new")}
            >
              {strings.modeNew}
            </button>
          </div>

          {/* Existing mode, no selection yet: debounced picker */}
          {clientMode === "existing" && !selectedClient && (
            <>
              <LabeledInput
                label={strings.searchClientLabel}
                value={clientQuery}
                onChange={setClientQuery}
                placeholder={strings.searchClientPlaceholder}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto" }}>
                {clientResults.map((c) => (
                  <button key={c.userId} type="button" onClick={() => selectClient(c)} style={pickRowStyle}>
                    <span aria-hidden="true" style={avatarStyle}>
                      {initialsOf(c.name)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                      <span style={pickNameStyle}>{c.name}</span>
                      <span style={pickSubStyle}>{c.phone ?? c.email ?? "—"}</span>
                    </span>
                    <Chip tone="blue">
                      {c.caseCount === 1
                        ? strings.clientCaseCountOne
                        : interpStr(strings.clientCaseCount, { n: String(c.caseCount) })}
                    </Chip>
                  </button>
                ))}
                {!searching && clientResults.length === 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 10,
                      padding: "18px 0",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>
                      {strings.searchClientEmpty}
                    </p>
                    <GhostBtn size="md" full={false} icon="plus" onClick={() => switchClientMode("new")}>
                      {strings.createNewInline}
                    </GhostBtn>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Existing mode with a selection: "✓ Seleccionado" card (RF-VAN-018) */}
          {clientMode === "existing" && selectedClient && (
            <>
              <div style={selectedCardStyle}>
                <span aria-hidden="true" style={avatarStyle}>
                  {initialsOf(selectedClient.name)}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={pickNameStyle}>{selectedClient.name}</span>
                  <span style={pickSubStyle}>{selectedClient.phone ?? selectedClient.email ?? "—"}</span>
                </span>
                <Chip tone="gold">✓ {strings.selectedChip}</Chip>
                <GhostBtn size="md" full={false} onClick={clearSelectedClient}>
                  {strings.changeClient}
                </GhostBtn>
              </div>
              <p style={{ margin: "-4px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
                {strings.existingDataHint}
              </p>
            </>
          )}

          {/* Client fields — editable in new mode. After picking an existing
              client only the ADDRESS stays editable: name/phone/email are the
              client's identity (the phone is their login credential — one
              account per client) and never change from case creation. */}
          {(clientMode === "new" || selectedClient) && (
            <>
              <LabeledInput
                label={strings.clientName}
                value={name}
                onChange={setName}
                disabled={clientMode === "existing"}
              />
              <div>
                <LabeledInput
                  label={strings.clientEmail}
                  value={clientEmail}
                  onChange={setClientEmail}
                  inputMode="email"
                  placeholder="cliente@ejemplo.com"
                  type="email"
                  disabled={clientMode === "existing"}
                />
                <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
                  {clientMode === "existing" ? strings.clientEmailLocked : strings.clientEmailHint}
                </p>
              </div>
              <div>
                <LabeledInput
                  label={strings.clientPhone}
                  value={phone}
                  onChange={(v) => setPhone(v.replace(/[^\d() +-]/g, ""))}
                  inputMode="tel"
                  placeholder="(305) 555-0134"
                  disabled={clientMode === "existing"}
                />
                <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
                  {clientMode === "existing" ? strings.clientPhoneLocked : strings.phoneHint}
                </p>
              </div>

              {/* Full US mailing address — required (prefills the I-589). */}
              <div>
                <LabeledInput
                  label={strings.clientAddressLine1}
                  value={line1}
                  onChange={setLine1}
                  placeholder="123 Main St"
                />
                <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
                  {strings.addressHint}
                </p>
              </div>
              <LabeledInput
                label={strings.clientApartment}
                value={apartment}
                onChange={setApartment}
                placeholder="Apt 4B"
              />
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 2 }}>
                  <LabeledInput label={strings.clientCity} value={city} onChange={setCity} placeholder="Miami" />
                </div>
                <div style={{ flex: 1 }}>
                  <LabeledInput
                    label={strings.clientState}
                    value={stateCode}
                    onChange={(v) => setStateCode(v.toUpperCase().slice(0, 2))}
                    placeholder="FL"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <LabeledInput
                    label={strings.clientZip}
                    value={zip}
                    onChange={(v) => setZip(v.replace(/[^\d-]/g, "").slice(0, 10))}
                    inputMode="numeric"
                    placeholder="33101"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink-2)" }}>
              {strings.filterService}
            </span>
            <select
              value={serviceId}
              onChange={(e) => selectService(e.target.value)}
              style={selectStyle}
            >
              <option value="">{strings.selectService}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {/* RF-VAN-019 — non-blocking notice: the picked client already has a
              case of this service (N cases per client is legitimate). */}
          {dupCase && selectedClient && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 12,
                background: "color-mix(in srgb, #f59e0b 14%, transparent)",
                border: "1px solid color-mix(in srgb, #f59e0b 35%, transparent)",
              }}
            >
              <Icon name="info" size={15} color="#b45309" />
              <span style={{ flex: 1, fontSize: 13, color: "var(--ink-2)" }}>
                {interpStr(strings.dupCaseWarning, {
                  name: selectedClient.name,
                  service: dupCase.serviceLabel,
                })}
              </span>
              {caseLinkBase && (
                <a
                  href={`${caseLinkBase}/${dupCase.caseId}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 13, fontWeight: 800, color: "var(--accent)", textDecoration: "none" }}
                >
                  {strings.dupCaseView}
                </a>
              )}
            </div>
          )}

          {service && (
            <div>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink-2)" }}>
                {strings.selectPlan}
              </span>
              <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                {service.plans.map((p) => {
                  const on = planKind === p.kind;
                  return (
                    <button
                      key={p.kind}
                      type="button"
                      onClick={() => selectPlan(p)}
                      style={{
                        flex: "1 1 200px",
                        textAlign: "left",
                        cursor: "pointer",
                        borderRadius: 14,
                        border: on ? "2px solid var(--accent)" : "1px solid var(--line)",
                        background: on ? "var(--blue-soft)" : "var(--card)",
                        padding: "12px 14px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)" }}>
                          {p.label}
                        </span>
                        {p.kind === "with_lawyer" ? (
                          <Chip tone="gold">{strings.planWith}</Chip>
                        ) : (
                          <Chip tone="blue">{strings.planSelf}</Chip>
                        )}
                      </div>
                      <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                        {new Intl.NumberFormat("es-US", {
                          style: "currency",
                          currency: "USD",
                        }).format(p.priceCents / 100)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Parties — the applicant is implicit; the service's roles drive the rest */}
          {service && (
            <div>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink-2)" }}>
                {strings.partiesLabel}
              </span>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 8,
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "var(--blue-soft)",
                }}
              >
                <Icon name="info" size={15} color="var(--accent)" />
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                  {strings.partyApplicant}: <b>{name.trim() || "—"}</b>
                </span>
              </div>

              {service.partyRoles.length === 0 && (
                <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
                  {strings.partyOnlyApplicant}
                </p>
              )}

              {service.partyRoles.map((r) => {
                const names = partyNames[r.roleKey] ?? [""];
                return (
                  <div key={r.roleKey} style={{ marginTop: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink-2)" }}>
                        {r.label}
                      </span>
                      {r.cardinality === "multiple" && <Chip tone="blue">{strings.partyMultiple}</Chip>}
                      {r.required && <span style={{ fontSize: 12, color: "var(--red)" }}>*</span>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {names.map((nm, i) => (
                        <div key={i} style={{ display: "flex", gap: 8 }}>
                          <input
                            value={nm}
                            placeholder={strings.partyName}
                            onChange={(e) => setPartyName(r.roleKey, i, e.target.value)}
                            style={{ ...inputStyle, flex: 1 }}
                          />
                          {r.cardinality === "multiple" && names.length > 1 && (
                            <button
                              type="button"
                              aria-label={strings.removeParty}
                              onClick={() => removePartySlot(r.roleKey, i)}
                              style={{
                                width: 40,
                                borderRadius: 12,
                                border: "1px solid var(--line)",
                                background: "var(--card)",
                                cursor: "pointer",
                                display: "grid",
                                placeItems: "center",
                              }}
                            >
                              <Icon name="x" size={16} color="var(--ink-2)" />
                            </button>
                          )}
                        </div>
                      ))}
                      {r.cardinality === "multiple" && (
                        <GhostBtn size="md" full={false} icon="plus" onClick={() => addPartySlot(r.roleKey)}>
                          {strings.addParty}
                        </GhostBtn>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderRadius: 12,
              background: "var(--blue-soft)",
            }}
          >
            <Icon name="info" size={15} color="var(--accent)" />
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{strings.payHint}</span>
          </div>

          <LabeledInput
            label={strings.payPrice}
            value={priceDollars}
            onChange={(v) => setPriceDollars(v.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            placeholder="3500"
          />
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <LabeledInput
                label={strings.payDownpayment}
                value={downDollars}
                onChange={(v) => setDownDollars(v.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="500"
              />
            </div>
            <div style={{ flex: 1 }}>
              <LabeledInput
                label={strings.payInstallments}
                value={installmentsCount}
                onChange={(v) => setInstallmentsCount(v.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="12"
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink-2)" }}>
              {strings.payFrequency}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {(["monthly", "weekly"] as const).map((f) => {
                const on = frequency === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrequency(f)}
                    style={{
                      flex: 1,
                      cursor: "pointer",
                      borderRadius: 12,
                      border: on ? "2px solid var(--accent)" : "1px solid var(--line)",
                      background: on ? "var(--blue-soft)" : "var(--card)",
                      padding: "9px 12px",
                      fontSize: 13,
                      fontWeight: on ? 800 : 500,
                      color: on ? "var(--ink)" : "var(--ink-2)",
                    }}
                  >
                    {f === "monthly" ? strings.payFrequencyMonthly : strings.payFrequencyWeekly}
                  </button>
                );
              })}
            </div>
          </div>

          {paymentValid && monthlyCount > 0 && (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
              {interpStr(frequency === "weekly" ? strings.payWeeklyPreview : strings.payMonthlyPreview, {
                count: String(monthlyCount),
                amount: formatUsd(monthlyCents),
              })}
            </p>
          )}

          <LabeledInput
            label={strings.payNote}
            value={discountNote}
            onChange={setDiscountNote}
            placeholder={strings.payNotePlaceholder}
          />
        </div>
      )}

      {step === 4 && signingLink && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 16,
            padding: "12px 0 8px",
          }}
        >
          {/* Success badge */}
          <div
            aria-hidden="true"
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "var(--blue-soft)",
              display: "grid",
              placeItems: "center",
              boxShadow: "0 0 0 8px color-mix(in srgb, var(--accent) 8%, transparent)",
            }}
          >
            <Icon name="check" size={34} color="var(--accent)" />
          </div>

          <p
            style={{
              margin: 0,
              fontSize: 14.5,
              color: "var(--ink-2)",
              lineHeight: 1.55,
              maxWidth: 400,
            }}
          >
            {strings.linkBody}
          </p>

          {/* Signing link */}
          <div
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "var(--blue-soft)",
              border: "1px solid color-mix(in srgb, var(--accent) 18%, transparent)",
              borderRadius: 12,
              padding: "12px 14px",
              boxSizing: "border-box",
            }}
          >
            <Icon name="lock" size={16} color="var(--accent)" />
            <code
              style={{
                flex: 1,
                textAlign: "left",
                fontSize: 12.5,
                color: "var(--ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {signingLink}
            </code>
          </div>

          <GradientBtn size="md" full icon="copy" onClick={copyLink}>
            {strings.copyLink}
          </GradientBtn>
        </div>
      )}
    </Modal>
  );
}

/** Whole-dollar string for an input from integer cents (e.g. 350000 → "3500"). */
function centsToInput(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "";
  return String(Math.round(cents / 100));
}

/** Parses a dollar string ("3500" / "3500.50") to integer cents; NaN if invalid. */
function parseDollarsToCents(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100);
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("es-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

function interpStr(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** Initials for the picker avatar (first letters of up to two name words). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

const inputStyle: React.CSSProperties = {
  height: 44,
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "var(--card)",
  color: "var(--ink)",
  padding: "0 14px",
  fontSize: 14,
  fontFamily: "var(--font-body)",
};

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer" };

// --- Step-1 client picker styles (RF-VAN-018) -------------------------------
// Inline (not vanessa.css .pick-row): this modal also mounts under /admin/casos
// where the vanessa stylesheet does not load.

const segmentedStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: 4,
  borderRadius: 12,
  background: "var(--blue-soft)",
};

function segBtnStyle(on: boolean): React.CSSProperties {
  return {
    flex: 1,
    height: 38,
    borderRadius: 9,
    border: "none",
    cursor: "pointer",
    fontSize: 13.5,
    fontWeight: 800,
    fontFamily: "var(--font-body)",
    color: on ? "var(--ink)" : "var(--ink-3)",
    background: on ? "var(--card)" : "transparent",
    boxShadow: on ? "0 1px 4px rgba(15, 23, 42, 0.12)" : "none",
  };
}

const pickRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "var(--card)",
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "var(--font-body)",
};

const selectedCardStyle: React.CSSProperties = {
  ...pickRowStyle,
  cursor: "default",
  border: "2px solid var(--accent)",
  background: "var(--blue-soft)",
};

const avatarStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: "50%",
  flexShrink: 0,
  display: "grid",
  placeItems: "center",
  fontSize: 13,
  fontWeight: 800,
  color: "var(--accent)",
  background: "color-mix(in srgb, var(--accent) 14%, transparent)",
};

const pickNameStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 800,
  fontSize: 14,
  color: "var(--ink)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const pickSubStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12.5,
  color: "var(--ink-3)",
};

function LabeledInput({
  label,
  value,
  onChange,
  inputMode,
  placeholder,
  type,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
  type?: React.InputHTMLAttributes<HTMLInputElement>["type"];
  disabled?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink-2)" }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        type={type}
        disabled={disabled}
        style={disabled ? { ...inputStyle, opacity: 0.6, cursor: "not-allowed" } : inputStyle}
      />
    </label>
  );
}
