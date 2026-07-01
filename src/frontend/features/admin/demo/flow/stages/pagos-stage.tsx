"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { GradientBtn, Icon } from "@/frontend/components/brand";
import { ScreenHead } from "@/frontend/components/mobile/screen-head";
import type { DemoFlow } from "../use-demo-flow";

/**
 * PagosStage — replica of the client Pagos view (DOC-51). Simplified for the
 * demo to a single "Pagar ahora" → processing → success (no Zelle/Card picker).
 */
export function PagosStage({ flow }: { flow: DemoFlow }) {
  const t = useTranslations("cliente.pagos");
  const { actions, scenario } = flow;
  const { contract } = scenario;
  const total = contract.installments.length;

  return (
    <div style={{ position: "relative", minHeight: "100%", padding: "16px 20px 130px" }}>
      <ScreenHead
        onBack={actions.goCases}
        title={t("title")}
        sub="Activa tu caso con tu primera cuota."
        lexMood="feliz"
      />

      {/* Next installment (navy) */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, var(--brand-navy), #013a73)",
          borderRadius: 24,
          padding: "22px 20px 20px",
          color: "#fff",
          boxShadow: "0 18px 40px color-mix(in srgb, var(--brand-navy) 25%, transparent)",
          marginBottom: 18,
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
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", fontWeight: 600 }}>{t("nextLabel")}</div>
          <div className="t-black" style={{ fontSize: 34, fontWeight: 800, margin: "2px 0 6px" }}>
            {contract.nextAmount}
          </div>
          <div style={{ fontSize: 14, color: "var(--gold)", fontWeight: 700, marginBottom: 14 }}>
            {t("progressLabel", { paid: 0, total })}
          </div>
          <div
            style={{
              height: 9,
              borderRadius: 999,
              background: "rgba(255,255,255,0.16)",
              overflow: "hidden",
              marginBottom: 18,
            }}
          >
            <div style={{ width: "0%", height: "100%", background: "linear-gradient(90deg, var(--gold), var(--gold-deep))" }} />
          </div>
          <GradientBtn icon="wallet" onClick={actions.pay}>
            {t("payNow")}
          </GradientBtn>
        </div>
      </div>

      {/* Plan */}
      <h2 className="t-title" style={{ margin: "0 0 12px", fontSize: 18, color: "var(--navy)", fontWeight: 700 }}>
        {t("planTitle")}
      </h2>
      <div style={{ background: "var(--card)", borderRadius: 24, boxShadow: "var(--shadow-soft)", overflow: "hidden" }}>
        {contract.installments.map((it, i) => (
          <div
            key={it.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: 16,
              borderBottom: i < total - 1 ? "1px solid var(--line)" : "none",
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                background: i === 0 ? "var(--blue-soft)" : "var(--line)",
                color: i === 0 ? "var(--accent)" : "var(--ink-3)",
                fontFamily: "var(--font-title)",
                fontWeight: 800,
                fontSize: 14,
              }}
            >
              {i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: "var(--navy)", fontWeight: 700 }}>
                {it.label} · {it.amount}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 600 }}>{it.due}</div>
            </div>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 800,
                fontFamily: "var(--font-title)",
                color: i === 0 ? "var(--gold-deep)" : "var(--ink-3)",
              }}
            >
              {i === 0 ? t("statusDue") : t("statusScheduled")}
            </span>
          </div>
        ))}
      </div>

      {/* Safety footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          marginTop: 16,
          color: "var(--ink-3)",
          fontSize: 13.5,
          fontWeight: 600,
        }}
      >
        <Icon name="lock" size={15} color="var(--green)" />
        {t("footerSafe")}
      </div>
    </div>
  );
}
