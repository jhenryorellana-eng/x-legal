"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Icon, IconTile } from "@/frontend/components/brand";
import { Logo } from "@/frontend/components/brand/logo";
import { serviceColorToken } from "../../scenarios";
import type { DemoFlow } from "../use-demo-flow";
import type { DemoService } from "../client-flow";

/**
 * CasesStage — replica of the client "Mis casos" home (DOC-51 §5). Renders the
 * two-step onboarding card (sign → pay) until both are done, then the active
 * navy case card. Pixel styles match dashboard-screen.tsx; interactions drive
 * the demo state machine.
 */
export function CasesStage({ flow, service }: { flow: DemoFlow; service: DemoService }) {
  const t = useTranslations("cliente.home");
  const { state, actions, scenario } = flow;
  const color = serviceColorToken(service.colorKey);

  return (
    <div style={{ position: "relative", minHeight: "100%", padding: "18px 20px 130px" }}>
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <Logo size={26} withWordmark wordmarkSize={15} />
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink-2)", fontSize: 15, fontWeight: 600 }}>{t("greetingEyebrow")}</div>
          <h1 className="t-black" style={{ margin: "2px 0 0", fontSize: 27, color: "var(--navy)" }}>
            {t("greeting", { name: scenario.client.firstName })}
          </h1>
        </div>
        <div
          aria-hidden
          style={{
            width: 48,
            height: 48,
            borderRadius: 999,
            background: "linear-gradient(135deg, var(--accent), var(--brand-navy))",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            color: "#fff",
            fontSize: 19,
            boxShadow: "var(--shadow-soft)",
          }}
        >
          {scenario.client.firstName.charAt(0)}
        </div>
      </div>

      {/* Tus casos */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Icon name="briefcase" size={21} color="var(--navy)" />
        <h2 className="t-title" style={{ margin: 0, fontSize: 20, color: "var(--navy)", fontWeight: 700 }}>
          {t("yourCases")}
        </h2>
      </div>

      {state.paid ? (
        <ActiveCaseCard
          title={scenario.caseTitle}
          phaseLabel={scenario.phaseLabel}
          icon={service.icon}
          docsLeft={t("documentsLeft", { n: scenario.phases[0].documents.length })}
          openCase={t("openCase")}
          onOpen={actions.openCase}
        />
      ) : (
        <OnboardingCard
          title={scenario.caseTitle}
          icon={service.icon}
          color={color}
          signed={state.signed}
          labels={{
            activate: t("activateTitle"),
            stepSign: t("stepSign"),
            stepPay: t("stepPay"),
            signCta: t("signCta"),
            payNow: t("payNow"),
            done: t("stepDoneLabel"),
            later: t("stepLaterLabel"),
            locked: t("lockedLabel"),
          }}
          onSign={actions.goSign}
          onPay={actions.goPay}
        />
      )}
    </div>
  );
}

/* ── Onboarding card (sign → pay) ──────────────────────────────────────────── */

const pillBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "linear-gradient(135deg, var(--accent), var(--brand-navy))",
  color: "#fff",
  border: "none",
  cursor: "pointer",
  borderRadius: 999,
  padding: "8px 14px",
  fontSize: 13.5,
  fontWeight: 800,
  fontFamily: "var(--font-title)",
  flexShrink: 0,
};

const mutedTag: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "var(--ink-3)", flexShrink: 0 };

function StepRow({
  index,
  label,
  done,
  dim,
  children,
}: {
  index: number;
  label: string;
  done: boolean;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: dim ? 0.55 : 1 }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 14,
          color: done ? "#fff" : "var(--navy)",
          background: done ? "var(--green)" : "color-mix(in srgb, var(--gold) 22%, transparent)",
          transition: "background .4s ease",
        }}
      >
        {done ? <Icon name="check" size={16} color="#fff" /> : index}
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: "var(--navy)" }}>{label}</div>
      {children}
    </div>
  );
}

function OnboardingCard({
  title,
  icon,
  color,
  signed,
  labels,
  onSign,
  onPay,
}: {
  title: string;
  icon: DemoService["icon"];
  color: string;
  signed: boolean;
  labels: {
    activate: string;
    stepSign: string;
    stepPay: string;
    signCta: string;
    payNow: string;
    done: string;
    later: string;
    locked: string;
  };
  onSign: () => void;
  onPay: () => void;
}) {
  return (
    <div
      className="mp-lift"
      style={{
        position: "relative",
        overflow: "hidden",
        background: "var(--card)",
        border: "1px solid color-mix(in srgb, var(--gold) 35%, transparent)",
        borderRadius: 24,
        padding: 18,
        marginBottom: 14,
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: -40,
          top: -40,
          width: 140,
          height: 140,
          borderRadius: "50%",
          background: "radial-gradient(circle, color-mix(in srgb, var(--gold) 22%, transparent), transparent 70%)",
        }}
      />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 13, marginBottom: 16 }}>
        <IconTile name={icon} color={color} size={46} radius={13} iconSize={24} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: "var(--gold-deep, var(--gold))",
            }}
          >
            {labels.activate}
          </div>
          <div className="t-title" style={{ fontSize: 16.5, color: "var(--navy)", fontWeight: 800, marginTop: 1 }}>
            {title}
          </div>
        </div>
      </div>

      <StepRow index={1} label={labels.stepSign} done={signed}>
        {signed ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--green)",
              flexShrink: 0,
            }}
          >
            <Icon name="check" size={14} color="var(--green)" /> {labels.done}
          </span>
        ) : (
          <button type="button" onClick={onSign} style={pillBtn}>
            {labels.signCta} <Icon name="chevR" size={16} color="#fff" />
          </button>
        )}
      </StepRow>

      <div
        aria-hidden
        style={{
          marginLeft: 15,
          height: 14,
          borderLeft: "2px dashed color-mix(in srgb, var(--ink-3) 40%, transparent)",
        }}
      />

      <StepRow index={2} label={labels.stepPay} done={false} dim={!signed}>
        {signed ? (
          <button type="button" onClick={onPay} style={pillBtn}>
            {labels.payNow} <Icon name="chevR" size={16} color="#fff" />
          </button>
        ) : (
          <span style={mutedTag}>{labels.later}</span>
        )}
      </StepRow>

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginTop: 14,
          color: "var(--ink-3)",
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        <Icon name="lock" size={14} color="var(--ink-3)" />
        {labels.locked}
      </div>
    </div>
  );
}

/* ── Active case card ──────────────────────────────────────────────────────── */

function ActiveCaseCard({
  title,
  phaseLabel,
  icon,
  docsLeft,
  openCase,
  onOpen,
}: {
  title: string;
  phaseLabel: string;
  icon: DemoService["icon"];
  docsLeft: string;
  openCase: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mp-lift demo-pop"
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        textAlign: "left",
        overflow: "hidden",
        border: "none",
        cursor: "pointer",
        background: "linear-gradient(135deg, var(--brand-navy), #013a73)",
        borderRadius: 24,
        padding: 20,
        marginBottom: 14,
        boxShadow: "0 18px 40px color-mix(in srgb, var(--brand-navy) 25%, transparent)",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: -30,
          top: -30,
          width: 140,
          height: 140,
          borderRadius: "50%",
          background: "radial-gradient(circle, color-mix(in srgb, var(--gold) 20%, transparent), transparent 70%)",
        }}
      />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 13, marginBottom: 16 }}>
        <div
          style={{
            width: 50,
            height: 50,
            borderRadius: 15,
            background: "rgba(255,255,255,0.14)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon name={icon} size={27} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-title" style={{ fontSize: 19, color: "#fff", fontWeight: 800 }}>
            {title}
          </div>
          <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.72)", fontWeight: 600, marginTop: 1 }}>
            {phaseLabel}
          </div>
        </div>
      </div>
      <div
        style={{
          position: "relative",
          height: 9,
          borderRadius: 999,
          background: "rgba(255,255,255,0.16)",
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: "6%",
            height: "100%",
            borderRadius: 999,
            background: "linear-gradient(90deg, var(--gold), var(--gold-deep))",
            transition: "width 0.9s cubic-bezier(.4,0,.2,1)",
          }}
        />
      </div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#fff", fontSize: 14.5, fontWeight: 700, minWidth: 0 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              flexShrink: 0,
              background: "var(--gold)",
              boxShadow: "0 0 0 4px color-mix(in srgb, var(--gold) 20%, transparent)",
            }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{docsLeft}</span>
        </div>
        <span
          className="t-title"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            flexShrink: 0,
            background: "#fff",
            color: "var(--accent)",
            borderRadius: 999,
            padding: "9px 16px",
            fontSize: 14.5,
            fontWeight: 800,
          }}
        >
          {openCase} <Icon name="chevR" size={17} color="var(--accent)" />
        </span>
      </div>
    </button>
  );
}
