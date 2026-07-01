"use client";

import * as React from "react";
import { Chip, GradientBtn, Icon } from "@/frontend/components/brand";
import type { DemoForm } from "../../scenarios/types";

/**
 * FormReview — full-screen panel (over the case) that shows every answered
 * question of a completed form, then "Enviar y finalizar". Pure UI: submitting
 * raises the formSent success overlay via the state machine.
 */
export function FormReview({
  form,
  onClose,
  onSend,
  sendLabel,
  completeLabel,
}: {
  form: DemoForm;
  onClose: () => void;
  onSend: () => void;
  sendLabel: string;
  completeLabel: string;
}) {
  // Stagger the cascade entrance across all visible Q&A rows.
  let rowIndex = 0;

  return (
    <div
      className="demo-overlay"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 52,
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), var(--bg)",
      }}
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          padding: "16px 18px 12px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderBottom: "1px solid var(--line)",
          background: "color-mix(in srgb, var(--card) 80%, transparent)",
          backdropFilter: "blur(10px)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Volver"
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            border: "none",
            background: "var(--card)",
            boxShadow: "var(--shadow-soft)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Icon name="arrowL" size={20} color="var(--navy)" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-title" style={{ fontSize: 17, fontWeight: 800, color: "var(--navy)" }}>
            {form.label}
          </div>
          <div style={{ marginTop: 3 }}>
            <Chip tone="green" dot>
              {completeLabel}
            </Chip>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 18px" }}>
        {form.sections.map((section) => (
          <div key={section.title} style={{ marginBottom: 18 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                margin: "4px 0 10px",
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  background: "var(--green-soft)",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <Icon name="check" size={14} color="var(--green)" stroke={3} />
              </span>
              <h3 className="t-title" style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--navy)" }}>
                {section.title}
              </h3>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {section.items.map((qa) => {
                const delay = Math.min(rowIndex++ * 0.045, 0.6);
                return (
                  <div
                    key={qa.q}
                    className="demo-cascade"
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--line)",
                      borderRadius: 14,
                      padding: "11px 14px",
                      animationDelay: `${delay}s`,
                    }}
                  >
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700, marginBottom: 3 }}>
                      {qa.q}
                    </div>
                    <div style={{ fontSize: 14.5, color: "var(--navy)", fontWeight: 700, lineHeight: 1.4 }}>
                      {qa.a}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          flexShrink: 0,
          padding: "12px 18px calc(16px + var(--safe-bottom))",
          borderTop: "1px solid var(--line)",
          background: "color-mix(in srgb, var(--card) 80%, transparent)",
          backdropFilter: "blur(10px)",
        }}
      >
        <GradientBtn icon="send" onClick={onSend}>
          {sendLabel}
        </GradientBtn>
      </div>
    </div>
  );
}
