"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { GradientBtn } from "@/frontend/components/brand";
import { ScreenHead } from "@/frontend/components/mobile/screen-head";
import { SignaturePad } from "@/frontend/components/mobile/signature-pad";
import type { DemoFlow } from "../use-demo-flow";

const SECTIONS = [
  {
    title: "Sobre este servicio",
    body: "UsaLatinoPrime te acompaña en tu proceso legal. No somos una agencia del gobierno y no garantizamos un resultado específico.",
  },
  {
    title: "Tu información",
    body: "Todo lo que compartas se trata de forma confidencial y se usa únicamente para preparar tu caso.",
  },
  {
    title: "Tu participación",
    body: "Tu colaboración entregando documentos verídicos y a tiempo es clave para avanzar tu caso con éxito.",
  },
];

/**
 * DisclaimerStage — replica of the in-case disclaimer (DOC-51 §0): legal scroll +
 * SignaturePad + acceptance. "Aceptar y continuar" enters the case.
 */
export function DisclaimerStage({ flow }: { flow: DemoFlow }) {
  const t = useTranslations("cliente.signature");
  const { actions } = flow;
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
        eyebrow="Legal"
        title="Bienvenida y consentimiento"
        sub="Lee este aviso y firma para abrir tu caso."
        lexMood="atento"
      />

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: 20,
          padding: 16,
          marginBottom: 16,
        }}
      >
        {SECTIONS.map((s) => (
          <div key={s.title} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--navy)", marginBottom: 4 }}>{s.title}</div>
            <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6 }}>{s.body}</p>
          </div>
        ))}
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--ink)", fontWeight: 700, lineHeight: 1.6 }}>
          Confirmo que se me explicó y entendí esta información.
        </p>
      </div>

      <SignaturePad labels={sigLabels} onChange={(s) => setSigned(s)} />

      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: "16px 0", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          style={{ width: 20, height: 20, marginTop: 1, accentColor: "var(--accent)", flexShrink: 0 }}
        />
        <span style={{ fontSize: 14.5, color: "var(--ink)", fontWeight: 600, lineHeight: 1.45 }}>
          Leí y acepto este consentimiento. Mi firma es válida para abrir mi caso.
        </span>
      </label>

      <GradientBtn icon="check" disabled={!signed || !accepted} onClick={actions.acceptDisclaimer}>
        Aceptar y continuar
      </GradientBtn>
    </div>
  );
}
