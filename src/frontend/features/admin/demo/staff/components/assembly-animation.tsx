"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand";
import type { DemoLoaderStep, DemoStaffI589Field } from "../../scenarios/types";

/**
 * AssemblyAnimation — the I-589 "Generar" centerpiece. A full-panel overlay with
 * two documents side by side: the plain-language form the client filled (left)
 * and the official USCIS I-589 AcroForm (right). For each answer a value-chip
 * flies across the gutter into its official field; empty fields are stamped
 * "N/A" automatically (8 CFR 1208.3(c)(3)). Pure CSS motion; a single completion
 * timer (cleared on unmount) drives `onComplete`.
 */
export interface AssemblyAnimationProps {
  title: string;
  officialTitle: string;
  fields: DemoStaffI589Field[];
  steps: DemoLoaderStep[];
  /** Already-formatted "N campos en N/A" chip label. */
  naLabel: string;
  leftPanelLabel: string;
  rightPanelLabel: string;
  onComplete: () => void;
}

const BASE = 220;
const STAGGER = 300;
const FLY = 820;
const HOLD = 950;
const ROW_H = 46;

export function AssemblyAnimation({
  title,
  officialTitle,
  fields,
  steps,
  naLabel,
  leftPanelLabel,
  rightPanelLabel,
  onComplete,
}: AssemblyAnimationProps) {
  const [step, setStep] = React.useState(0);
  const onCompleteRef = React.useRef(onComplete);
  onCompleteRef.current = onComplete;

  const total = BASE + fields.length * STAGGER + FLY + HOLD;

  React.useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const perStep = total / steps.length;
    for (let i = 0; i < steps.length; i++) {
      timers.push(setTimeout(() => setStep(i + 1), perStep * (i + 1)));
    }
    timers.push(setTimeout(() => onCompleteRef.current(), total));
    return () => timers.forEach(clearTimeout);
  }, [steps.length, total]);

  const currentStep = steps[Math.min(step, steps.length - 1)];

  return (
    <div
      className="demo-overlay"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "color-mix(in srgb, var(--brand-navy) 46%, transparent)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <div
        className="staff-rise"
        style={{
          width: "min(760px, calc(100vw - 24px))",
          maxHeight: "calc(100vh - 40px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background:
            "radial-gradient(130% 90% at 100% -10%, var(--blue-soft) 0%, transparent 48%), var(--card)",
          borderRadius: 24,
          boxShadow: "0 30px 70px rgba(11,27,51,0.36)",
        }}
      >
        {/* Header */}
        <div style={{ flexShrink: 0, padding: "16px 20px 10px", textAlign: "center" }}>
        <div className="t-black" style={{ fontSize: 18, color: "var(--navy)" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 600, marginTop: 2 }}>
          {officialTitle}
        </div>
      </div>

      {/* Panel labels */}
      <div style={{ flexShrink: 0, display: "flex", padding: "0 18px", gap: 44 }}>
        <PanelTag icon="form" label={leftPanelLabel} tone="var(--accent)" />
        <PanelTag icon="shield" label={rightPanelLabel} tone="var(--gold-deep)" official />
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "10px 18px 4px", position: "relative" }}>
        <div style={{ position: "relative" }}>
          {/* Two document rectangles behind the rows */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: "calc(50% - 22px)",
              background: "var(--card)",
              border: "1px solid var(--line)",
              borderRadius: 16,
              boxShadow: "var(--shadow-soft)",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: "calc(50% - 22px)",
              background: "color-mix(in srgb, var(--gold-soft) 45%, var(--card))",
              border: "1px solid color-mix(in srgb, var(--gold-deep) 26%, transparent)",
              borderRadius: 16,
              boxShadow: "var(--shadow-soft)",
            }}
          />

          {fields.map((f, i) => {
            const delay = BASE + i * STAGGER;
            const landed = delay + FLY * 0.62;
            const isNa = f.value == null;
            return (
              <div
                key={f.fieldName + i}
                style={{ position: "relative", height: ROW_H, display: "flex", alignItems: "center" }}
              >
                {/* Left cell — plain answer */}
                <div style={{ width: "calc(50% - 22px)", padding: "0 12px", minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {f.plain}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--navy)", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {f.value ?? "—"}
                  </div>
                </div>

                {/* Gutter */}
                <div style={{ width: 44, flexShrink: 0 }} />

                {/* Right cell — official field */}
                <div style={{ width: "calc(50% - 22px)", padding: "0 12px", minWidth: 0 }}>
                  <div style={{ fontSize: 9.5, color: "var(--ink-3)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {f.fieldName}
                  </div>
                  <div
                    className="staff-fill"
                    style={{
                      marginTop: 2,
                      height: 22,
                      borderRadius: 7,
                      border: "1px solid var(--line)",
                      background: "var(--card)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "0 8px",
                      animationDelay: `${landed}ms`,
                    }}
                  >
                    <span
                      className="staff-value-in"
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        color: isNa ? "var(--gold-deep)" : "var(--accent)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        animationDelay: `${landed}ms`,
                      }}
                    >
                      {isNa ? "N/A" : f.value}
                    </span>
                  </div>
                </div>

                {/* Flying value chip */}
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "3%",
                    transform: "translateY(-50%)",
                    padding: "3px 8px",
                    borderRadius: 7,
                    background: isNa ? "var(--gold-deep)" : "var(--accent)",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 800,
                    fontFamily: "var(--font-title)",
                    whiteSpace: "nowrap",
                    maxWidth: "40%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    boxShadow: "0 6px 14px rgba(11,27,51,0.22)",
                    animation: `staff-fly ${FLY}ms cubic-bezier(.4,0,.4,1) both`,
                    animationDelay: `${delay}ms`,
                  }}
                >
                  {isNa ? "N/A" : f.value}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer — current step + N/A callout */}
      <div
        style={{
          flexShrink: 0,
          padding: "12px 18px calc(14px + var(--safe-bottom, 0px))",
          borderTop: "1px solid var(--line)",
          background: "color-mix(in srgb, var(--card) 82%, transparent)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 999,
              border: "2.5px solid color-mix(in srgb, var(--accent) 32%, transparent)",
              borderTopColor: "var(--accent)",
              animation: "demo-spin .7s linear infinite",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 800, color: "var(--navy)", fontFamily: "var(--font-title)" }}>
            {currentStep?.text}
          </span>
        </span>
        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            background: "var(--gold-soft)",
            color: "var(--gold-deep)",
            borderRadius: 999,
            padding: "6px 12px",
            fontSize: 12.5,
            fontWeight: 800,
          }}
        >
          <Icon name="info" size={14} color="var(--gold-deep)" />
          {naLabel}
        </span>
      </div>
      </div>
    </div>
  );
}

function PanelTag({
  icon,
  label,
  tone,
  official,
}: {
  icon: "form" | "shield";
  label: string;
  tone: string;
  official?: boolean;
}) {
  return (
    <div
      style={{
        width: "calc(50% - 22px)",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 10,
        background: official ? "color-mix(in srgb, var(--gold-soft) 55%, transparent)" : "var(--blue-soft)",
      }}
    >
      <Icon name={icon} size={16} color={tone} />
      <span style={{ fontSize: 12.5, fontWeight: 800, color: tone, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
    </div>
  );
}
