"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { GradientBtn } from "@/frontend/components/brand";
import { ScreenHead } from "@/frontend/components/mobile/screen-head";
import { SignaturePad } from "@/frontend/components/mobile/signature-pad";
import type { DemoFlow } from "../use-demo-flow";
import type { PartyRole } from "../../scenarios/types";

const ROLE_LABEL: Record<PartyRole, string> = {
  applicant: "Titular",
  spouse: "Cónyuge",
  dependent: "Dependiente",
};

/**
 * SigningStage — replica of the public contract-signing view (DOC-51 §12). The
 * navy summary + the contract body + the SignaturePad + an acceptance checkbox.
 * "Firmar contrato" drives the success overlay; nothing is persisted.
 */
export function SigningStage({ flow }: { flow: DemoFlow }) {
  const t = useTranslations("cliente.signature");
  const { actions, scenario } = flow;
  const { contract, client } = scenario;
  const [signed, setSigned] = React.useState(false);
  const [accepted, setAccepted] = React.useState(false);

  const sigLabels = {
    draw: t("draw"),
    upload: t("upload"),
    placeholder: t("placeholder"),
    legend: t("legend"),
    uploadPrompt: t("uploadPrompt"),
    required: t("required"),
    ready: t("ready"),
    clear: t("clear"),
    undo: t("undo"),
  };

  return (
    <div style={{ minHeight: "100%", padding: "16px 20px 40px" }}>
      <ScreenHead
        onBack={actions.goCases}
        eyebrow="Tu contrato"
        title="Firma tu contrato"
        sub="Revisa los términos y firma para activar tu caso."
        lexMood="señala"
      />

      {/* Contract summary (navy) */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, var(--brand-navy), #013a73)",
          borderRadius: 24,
          padding: "20px 18px",
          color: "#fff",
          boxShadow: "0 18px 40px color-mix(in srgb, var(--brand-navy) 25%, transparent)",
          marginBottom: 16,
        }}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: -30,
            top: -30,
            width: 130,
            height: 130,
            borderRadius: "50%",
            background: "radial-gradient(circle, color-mix(in srgb, var(--gold) 20%, transparent), transparent 70%)",
          }}
        />
        <div style={{ position: "relative" }}>
          <span
            style={{
              display: "inline-block",
              background: "color-mix(in srgb, var(--gold) 26%, transparent)",
              color: "var(--gold)",
              borderRadius: 999,
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 800,
              marginBottom: 14,
            }}
          >
            {contract.planLabel}
          </span>

          {/* Parties */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {client.parties.map((p) => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{ROLE_LABEL[p.role]}</span>
              </div>
            ))}
          </div>

          {/* Payment plan */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {contract.installments.map((it) => (
              <div
                key={it.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  background: it.isDownPayment ? "color-mix(in srgb, var(--gold) 22%, transparent)" : "rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  padding: "9px 12px",
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 700, color: it.isDownPayment ? "var(--gold)" : "#fff" }}>
                  {it.label}
                </span>
                <span style={{ fontSize: 14, fontWeight: 800, color: it.isDownPayment ? "var(--gold)" : "#fff" }}>
                  {it.amount}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Contract body */}
      <div
        style={{
          maxHeight: 220,
          overflowY: "auto",
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: 20,
          padding: 16,
          marginBottom: 16,
        }}
      >
        {contract.clauses.map((c) => (
          <div key={c.title} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--navy)", marginBottom: 4 }}>{c.title}</div>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>{c.body}</p>
          </div>
        ))}
      </div>

      {/* Signature */}
      <SignaturePad labels={sigLabels} onChange={(s) => setSigned(s)} />

      {/* Acceptance */}
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: "16px 0", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          style={{ width: 20, height: 20, marginTop: 1, accentColor: "var(--accent)", flexShrink: 0 }}
        />
        <span style={{ fontSize: 14.5, color: "var(--ink)", fontWeight: 600, lineHeight: 1.45 }}>
          Leí el contrato y acepto sus términos. Mi firma es válida para celebrarlo.
        </span>
      </label>

      <GradientBtn icon="check" disabled={!signed || !accepted} onClick={actions.signContract}>
        Firmar contrato
      </GradientBtn>
    </div>
  );
}
