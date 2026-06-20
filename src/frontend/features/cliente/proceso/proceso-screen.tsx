"use client";

import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/frontend/components/brand/icon";
import { StatusPill } from "@/frontend/components/brand/status-pill";
import { ProgressBar } from "@/frontend/components/brand/progress-bar";
import { BottomSheet } from "@/frontend/components/mobile";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";

/**
 * ProcesoScreen — `/caso/[caseId]/proceso` (DOC-51 §22, prototype `screens4.jsx →
 * ProcessScreen`). Vertical milestone timeline + glossary bottom sheet.
 *
 * Client component (the glossary sheet is interactive). Milestone states are
 * derived server-side (current/next/locked/completed).
 */

export interface ProcesoMilestone {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  state: "completed" | "current" | "next" | "locked";
  progress: number | null;
  glossary: { term: string; body: string } | null;
}

export interface ProcesoLabels {
  back: string;
  title: string; // "Tu proceso avanza, {name}"
  subtitle: string; // "Estás en la Fase {x} de {y}. Vas muy bien."
  inProgress: string;
  next: string;
  progress: string;
  completed: string;
  whatDoesThisMean: string;
  gotIt: string;
  whatsNext: string;
  whatsNextBody: string;
}

export function ProcesoScreen({
  caseId,
  milestones,
  labels,
}: {
  caseId: string;
  milestones: ProcesoMilestone[];
  labels: ProcesoLabels;
}) {
  const [glossary, setGlossary] = React.useState<{ term: string; body: string } | null>(null);

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 20px var(--screen-pb)",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <Link
        href={`/caso/${caseId}/mas`}
        className="mp-tap"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--accent)",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 15,
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        <Icon name="chevL" size={18} color="var(--accent)" /> {labels.back}
      </Link>
      <h1
        className="t-black"
        style={{ margin: "0 0 4px", fontSize: 27, color: "var(--navy)", textWrap: "balance" }}
      >
        {labels.title}
      </h1>
      <p style={{ margin: "0 0 18px", fontSize: 15.5, color: "var(--ink-2)", fontWeight: 600 }}>
        {labels.subtitle}
      </p>

      <div style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: 23,
            top: 24,
            bottom: 70,
            width: 2.5,
            background: "var(--line)",
            borderRadius: 999,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {milestones.map((m) => {
            const curso = m.state === "current";
            const sig = m.state === "next";
            const bloq = m.state === "locked";
            return (
              <div key={m.id} style={{ display: "flex", gap: 15, position: "relative" }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 999,
                    flexShrink: 0,
                    zIndex: 1,
                    background: curso ? "var(--accent)" : "var(--card)",
                    border: curso
                      ? "none"
                      : `2.5px solid ${sig ? "color-mix(in srgb, var(--accent) 33%, transparent)" : "var(--line)"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: curso
                      ? "0 8px 18px color-mix(in srgb, var(--accent) 33%, transparent)"
                      : "none",
                    animation: curso ? "ringPulse 2.4s ease-out infinite" : "none",
                  }}
                >
                  {bloq ? (
                    <Icon name="lock" size={19} color="var(--ink-3)" />
                  ) : (
                    <Icon
                      name={m.icon}
                      size={23}
                      color={curso ? "#fff" : "var(--accent)"}
                      stroke={2.4}
                    />
                  )}
                </div>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: "var(--card)",
                    borderRadius: 18,
                    padding: "14px 16px",
                    boxShadow: curso
                      ? "0 14px 32px color-mix(in srgb, var(--accent) 15%, transparent)"
                      : "var(--shadow-soft)",
                    border: curso ? "2px solid var(--accent)" : "2px solid transparent",
                    opacity: bloq ? 0.66 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    {curso && <StatusPill kind="revision">{labels.inProgress}</StatusPill>}
                    {sig && (
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 800,
                          color: "var(--accent)",
                          background: "var(--blue-soft)",
                          borderRadius: 999,
                          padding: "3px 9px",
                        }}
                      >
                        {labels.next}
                      </span>
                    )}
                  </div>
                  <div
                    className="t-title"
                    style={{
                      fontSize: 16.5,
                      color: bloq ? "var(--ink-2)" : "var(--navy)",
                      fontWeight: 700,
                      lineHeight: 1.2,
                      textWrap: "balance",
                    }}
                  >
                    {m.title}
                  </div>
                  <p
                    style={{
                      margin: "5px 0 0",
                      fontSize: 14,
                      color: "var(--ink-2)",
                      fontWeight: 500,
                      lineHeight: 1.4,
                    }}
                  >
                    {m.description}
                  </p>
                  {curso && m.progress != null && (
                    <div style={{ marginTop: 12 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 6,
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--navy)" }}>
                          {labels.progress}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--gold-deep)" }}>
                          {m.progress}%
                        </span>
                      </div>
                      <ProgressBar pct={m.progress} />
                    </div>
                  )}
                  {m.glossary && (
                    <button
                      type="button"
                      onClick={() => setGlossary(m.glossary)}
                      className="mp-tap"
                      style={{
                        marginTop: 9,
                        background: "none",
                        border: "none",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        color: "var(--accent)",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: "pointer",
                        padding: 0,
                        fontFamily: "var(--font-title)",
                      }}
                    >
                      <Icon name="help" size={15} color="var(--accent)" />
                      {labels.whatDoesThisMean}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 15, alignItems: "center" }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                flexShrink: 0,
                zIndex: 1,
                background: "var(--gold-soft)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 0 4px color-mix(in srgb, var(--gold) 20%, transparent)",
              }}
            >
              <Icon name="trophy" size={24} color="var(--gold-deep)" />
            </div>
            <div
              className="t-title"
              style={{ fontSize: 18, color: "var(--gold-deep)", fontWeight: 800 }}
            >
              {labels.completed}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 20,
          background: "var(--blue-soft)",
          borderRadius: 20,
          padding: 18,
          display: "flex",
          gap: 13,
          alignItems: "flex-start",
        }}
      >
        <Icon name="info" size={22} color="var(--accent)" />
        <div>
          <div
            className="t-title"
            style={{ fontSize: 16, color: "var(--navy)", fontWeight: 700 }}
          >
            {labels.whatsNext}
          </div>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 14.5,
              color: "var(--ink-2)",
              fontWeight: 500,
              lineHeight: 1.45,
            }}
          >
            {labels.whatsNextBody}
          </p>
        </div>
      </div>

      <BottomSheet
        open={glossary != null}
        onClose={() => setGlossary(null)}
        title={glossary?.term ?? ""}
        hideHeader
        absolute
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 13,
              background: "var(--blue-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="help" size={24} color="var(--accent)" />
          </div>
          <h3
            className="t-title"
            style={{ margin: 0, fontSize: 20, color: "var(--navy)", fontWeight: 800 }}
          >
            {glossary?.term}
          </h3>
        </div>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 16,
            color: "var(--ink-2)",
            fontWeight: 500,
            lineHeight: 1.55,
            textWrap: "pretty",
          }}
        >
          {glossary?.body}
        </p>
        <GradientBtn c1="#2F6BFF" c2="#002855" onClick={() => setGlossary(null)}>
          {labels.gotIt}
        </GradientBtn>
      </BottomSheet>
    </div>
  );
}
