"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/frontend/components/brand/icon";
import { IconHalo } from "@/frontend/components/brand/icon-tile";
import { Card } from "@/frontend/components/brand/card";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { openTeamChat } from "@/frontend/features/messaging/team-chat-bus";
import { getBridge } from "@/frontend/platform-bridge";

/**
 * ServiceDetailScreen — `/servicios/[slug]` (DOC-51 §7), reworked as an
 * e-commerce style product page: the two plans (self / with-lawyer) with their
 * prices, a self-service "how it works" framing (the CLIENT does the filing; we
 * only guide them through the platform), the process stages + estimated duration,
 * and a WhatsApp CTA that opens a pre-filled message to the sales line.
 *
 * The submit CTA goes out through `getBridge().share.openExternal` (RNF-036):
 * features never touch `window.open` directly so a future Capacitor build can
 * swap the implementation.
 */

export interface ServiceDetailPlanVM {
  kind: "self" | "with_lawyer";
  /** Localized plan title ("Sin revisión de abogado" / "Con revisión de abogado"). */
  title: string;
  /** Formatted price, e.g. "$1,500". Null when the plan has no active price. */
  priceLabel: string | null;
  note: string;
  emphasized: boolean;
}

export interface ServiceDetailPhaseVM {
  label: string;
  explainer: string;
}

export interface ServiceDetailLabels {
  eyebrow: string;
  whatIs: string;
  pricingTitle: string;
  priceOneTime: string;
  priceSoon: string;
  howTitle: string;
  howIntro: string;
  how: string[];
  stagesTitle: string;
  durationTitle: string;
  whatsappCta: string;
  askByMessage: string;
}

export interface ServiceDetailScreenProps {
  name: string;
  shortDescription: string;
  longDescription: string;
  icon: IconName;
  color: string;
  plans: ServiceDetailPlanVM[];
  phases: ServiceDetailPhaseVM[];
  /** Always a string ("≈ 8 semanas" or the "varies by case" fallback). */
  durationLabel: string;
  /** Pre-built wa.me URL with the localized predefined message. */
  whatsappUrl: string;
  labels: ServiceDetailLabels;
}

export function ServiceDetailScreen({
  name,
  shortDescription,
  longDescription,
  icon,
  color,
  plans,
  phases,
  durationLabel,
  whatsappUrl,
  labels,
}: ServiceDetailScreenProps) {
  const router = useRouter();

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "26px 20px var(--screen-pb)",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      {/* Back + eyebrow */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => router.push("/servicios")}
          aria-label={labels.eyebrow}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "none",
            background: "var(--card)",
            boxShadow: "var(--shadow-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Icon name="arrowL" size={22} color="var(--navy)" />
        </button>
        <div style={{ color: "var(--ink-2)", fontWeight: 700, fontSize: 15, marginTop: 12 }}>
          {labels.eyebrow}
        </div>
      </div>

      {/* Hero */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          marginBottom: 22,
        }}
      >
        <div
          style={{
            position: "relative",
            width: 84,
            height: 84,
            borderRadius: 24,
            background: "var(--card)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            boxShadow: `0 12px 28px color-mix(in srgb, ${color} 20%, transparent)`,
            marginBottom: 14,
          }}
        >
          <IconHalo color={color} size={84} opacity={0.7} />
          <span style={{ position: "relative", display: "flex" }}>
            <Icon name={icon} size={42} color={color} />
          </span>
        </div>
        <h1
          className="t-black"
          style={{ margin: "0 0 6px", fontSize: 27, color: "var(--navy)", textWrap: "balance" }}
        >
          {name}
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: 16,
            color: "var(--ink-2)",
            fontWeight: 500,
            maxWidth: 320,
            textWrap: "pretty",
          }}
        >
          {shortDescription}
        </p>
      </div>

      {/* Pricing — the two plans (self / with lawyer) */}
      <SectionTitle>{labels.pricingTitle}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        {plans.map((p) => (
          <div
            key={p.kind}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--card)",
              borderRadius: 18,
              padding: "15px 16px",
              border: p.emphasized
                ? "1.5px solid color-mix(in srgb, var(--accent) 55%, transparent)"
                : "1.5px solid var(--line)",
              boxShadow: p.emphasized
                ? "0 10px 26px color-mix(in srgb, var(--accent) 14%, transparent)"
                : "var(--shadow-soft)",
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                background: p.emphasized ? "var(--blue-soft)" : "var(--card-alt, var(--bg))",
              }}
            >
              <Icon
                name={p.kind === "with_lawyer" ? "shield" : "check"}
                size={20}
                color={p.emphasized ? "var(--accent)" : "var(--ink-3)"}
                stroke={2.4}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="t-title"
                style={{ fontSize: 15.5, color: "var(--navy)", fontWeight: 700, lineHeight: 1.2 }}
              >
                {p.title}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  fontWeight: 500,
                  marginTop: 3,
                  lineHeight: 1.4,
                }}
              >
                {p.note}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div
                className="t-black"
                style={{ fontSize: 19, color: "var(--navy)", fontWeight: 800, lineHeight: 1 }}
              >
                {p.priceLabel ?? labels.priceSoon}
              </div>
              {p.priceLabel ? (
                <div style={{ fontSize: 10.5, color: "var(--ink-3)", fontWeight: 700, marginTop: 3 }}>
                  {labels.priceOneTime}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {/* ¿Qué es? */}
      <Card style={{ padding: 18, marginBottom: 14 }}>
        <h3
          className="t-title"
          style={{ margin: "0 0 8px", fontSize: 18, color: "var(--navy)", fontWeight: 700 }}
        >
          {labels.whatIs}
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: 15.5,
            lineHeight: 1.6,
            color: "var(--ink-2)",
            fontWeight: 500,
            textWrap: "pretty",
          }}
        >
          {longDescription}
        </p>
      </Card>

      {/* ¿Cómo funciona? — self-service framing (the client does it; we guide) */}
      <SectionTitle>{labels.howTitle}</SectionTitle>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          background: "var(--gold-soft)",
          borderRadius: 16,
          padding: 14,
          marginBottom: 12,
        }}
      >
        <Icon name="info" size={20} color="var(--gold-deep)" />
        <span style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 600, lineHeight: 1.5 }}>
          {labels.howIntro}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        {labels.how.map((h, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              background: "var(--card)",
              borderRadius: 16,
              padding: 14,
              boxShadow: "var(--shadow-soft)",
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                background: "var(--green-soft)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              <Icon name="check" size={18} color="var(--green)" stroke={3} />
            </div>
            <span style={{ fontSize: 15, lineHeight: 1.5, color: "var(--ink)", fontWeight: 600 }}>
              {h}
            </span>
          </div>
        ))}
      </div>

      {/* Etapas del trámite + duración */}
      {phases.length > 0 ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
              margin: "8px 0 12px",
            }}
          >
            <h3
              className="t-title"
              style={{ margin: 0, fontSize: 18, color: "var(--navy)", fontWeight: 700 }}
            >
              {labels.stagesTitle}
            </h3>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "var(--blue-soft)",
                color: "var(--accent)",
                borderRadius: 999,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 800,
                whiteSpace: "nowrap",
              }}
            >
              <Icon name="clock" size={13} color="var(--accent)" stroke={2.6} />
              {durationLabel}
            </span>
          </div>
          <Card style={{ padding: "16px 16px 8px", marginBottom: 22 }}>
            {phases.map((ph, i) => (
              <div key={i} style={{ display: "flex", gap: 13, paddingBottom: 16 }}>
                {/* Stepper rail */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background:
                        "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--brand-navy) 70%, var(--accent)))",
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 13,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </div>
                  {i < phases.length - 1 ? (
                    <div style={{ flex: 1, width: 2, background: "var(--line)", marginTop: 4 }} />
                  ) : null}
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                  <div
                    className="t-title"
                    style={{ fontSize: 15.5, color: "var(--navy)", fontWeight: 700 }}
                  >
                    {ph.label}
                  </div>
                  {ph.explainer ? (
                    <div
                      style={{
                        fontSize: 13.5,
                        color: "var(--ink-2)",
                        fontWeight: 500,
                        marginTop: 3,
                        lineHeight: 1.5,
                      }}
                    >
                      {ph.explainer}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </Card>
        </>
      ) : null}

      {/* CTAs — submit goes to WhatsApp with a predefined message */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <GradientBtn
          icon="chat"
          c1="#25D366"
          c2="#128C7E"
          onClick={() => getBridge().share.openExternal(whatsappUrl)}
        >
          {labels.whatsappCta}
        </GradientBtn>
        <GhostBtn icon="chat" onClick={() => openTeamChat()}>
          {labels.askByMessage}
        </GhostBtn>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="t-title"
      style={{ margin: "8px 0 12px", fontSize: 18, color: "var(--navy)", fontWeight: 700 }}
    >
      {children}
    </h3>
  );
}
