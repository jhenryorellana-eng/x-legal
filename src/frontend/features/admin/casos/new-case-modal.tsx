"use client";

/**
 * "Nuevo caso" — 2-step modal (DOC-53 §3, resolución H-2).
 *
 * Step 1 — Client details: full name + US phone (normalized to E.164 server-side).
 * Step 2 — Service + plan + parties → createCase action → shows the signing link
 *          to copy/send.
 *
 * The create action wraps the available backend surface (createContract + plan).
 * See the app action for the user-creation reconciliation note (no exposed
 * client-creation API in the cases/identity module-pub yet).
 */

import * as React from "react";
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
}

export interface NewCaseService {
  id: string;
  label: string;
  plans: NewCasePlan[];
  /** Per-plan-kind encoded resolution string the create action decodes. */
  encodedByKind: Record<string, string>;
}

export interface NewCaseInput {
  clientName: string;
  clientPhone: string;
  /** Encoded plan resolution string: serviceId|planId|price|down|installments. */
  serviceId: string;
  planKind: "self" | "with_lawyer";
  parties: { name: string; role: string }[];
}

export interface NewCaseActions {
  createCase: (
    input: NewCaseInput,
  ) => Promise<{ ok: boolean; signingToken?: string; error?: { code: string; message?: string } }>;
}

export function NewCaseModal({
  open,
  onOpenChange,
  services,
  strings,
  actions,
  signingBaseUrl,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  services: NewCaseService[];
  strings: CasosStrings;
  actions: NewCaseActions;
  signingBaseUrl: string;
}) {
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [serviceId, setServiceId] = React.useState("");
  const [planKind, setPlanKind] = React.useState<"self" | "with_lawyer" | "">("");
  const [parties, setParties] = React.useState<{ name: string; role: string }[]>([
    { name: "", role: "" },
  ]);
  const [submitting, setSubmitting] = React.useState(false);
  const [signingLink, setSigningLink] = React.useState<string | null>(null);

  const service = services.find((s) => s.id === serviceId);

  function reset() {
    setStep(1);
    setName("");
    setPhone("");
    setServiceId("");
    setPlanKind("");
    setParties([{ name: "", role: "" }]);
    setSigningLink(null);
  }

  function close(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  const step1Valid = name.trim().length > 1 && phone.replace(/\D/g, "").length === 10;
  const step2Valid = !!serviceId && !!planKind;

  async function submit() {
    if (!step2Valid) return;
    setSubmitting(true);
    const encoded = service?.encodedByKind[planKind] ?? serviceId;
    const res = await actions.createCase({
      clientName: name.trim(),
      clientPhone: phone,
      serviceId: encoded,
      planKind: planKind as "self" | "with_lawyer",
      // Only fully-specified parties (name AND role) — a half-filled row is
      // dropped rather than rejected by the domain (party_role requires ≥1 char).
      parties: parties.filter((p) => p.name.trim() && p.role.trim()),
    });
    setSubmitting(false);
    if (res.ok && res.signingToken) {
      setSigningLink(`${signingBaseUrl}/firma/${res.signingToken}`);
      setStep(3);
    } else {
      toast.error(res.error?.message ?? strings.errorTitle);
    }
  }

  async function copyLink() {
    if (!signingLink) return;
    try {
      await navigator.clipboard.writeText(signingLink);
      toast.success(strings.copied);
    } catch {
      toast.error(strings.errorTitle);
    }
  }

  const title =
    step === 1 ? strings.newCaseStep1 : step === 2 ? strings.newCaseStep2 : strings.linkTitle;

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={title}
      width={560}
      footer={
        step === 3 ? (
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
        ) : (
          <>
            <GhostBtn size="md" full={false} icon="chevL" onClick={() => setStep(1)}>
              {strings.back}
            </GhostBtn>
            <GradientBtn
              size="md"
              full={false}
              icon="lock"
              disabled={!step2Valid || submitting}
              onClick={submit}
            >
              {submitting ? strings.creating : strings.createCase}
            </GradientBtn>
          </>
        )
      }
    >
      {/* Step indicator */}
      {step !== 3 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {[1, 2].map((n) => (
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
          <LabeledInput label={strings.clientName} value={name} onChange={setName} />
          <div>
            <LabeledInput
              label={strings.clientPhone}
              value={phone}
              onChange={(v) => setPhone(v.replace(/[^\d() +-]/g, ""))}
              inputMode="tel"
              placeholder="(305) 555-0134"
            />
            <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
              {strings.phoneHint}
            </p>
          </div>
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
              onChange={(e) => {
                setServiceId(e.target.value);
                setPlanKind("");
              }}
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
                      onClick={() => setPlanKind(p.kind)}
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

          {/* Parties */}
          <div>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink-2)" }}>
              {strings.partiesLabel}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {parties.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <input
                    value={p.name}
                    placeholder={strings.partyName}
                    onChange={(e) =>
                      setParties((prev) =>
                        prev.map((pp, j) => (j === i ? { ...pp, name: e.target.value } : pp)),
                      )
                    }
                    style={{ ...inputStyle, flex: 2 }}
                  />
                  <input
                    value={p.role}
                    placeholder={strings.partyRole}
                    onChange={(e) =>
                      setParties((prev) =>
                        prev.map((pp, j) => (j === i ? { ...pp, role: e.target.value } : pp)),
                      )
                    }
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  {parties.length > 1 && (
                    <button
                      type="button"
                      aria-label={strings.removeParty}
                      onClick={() => setParties((prev) => prev.filter((_, j) => j !== i))}
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
              <GhostBtn
                size="md"
                full={false}
                icon="plus"
                onClick={() => setParties((prev) => [...prev, { name: "", role: "" }])}
              >
                {strings.addParty}
              </GhostBtn>
            </div>
          </div>
        </div>
      )}

      {step === 3 && signingLink && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>
            {strings.linkBody}
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "var(--blue-soft)",
              borderRadius: 12,
              padding: "12px 14px",
            }}
          >
            <Icon name="lock" size={16} color="var(--accent)" />
            <code
              style={{
                flex: 1,
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

function LabeledInput({
  label,
  value,
  onChange,
  inputMode,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink-2)" }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        style={inputStyle}
      />
    </label>
  );
}
