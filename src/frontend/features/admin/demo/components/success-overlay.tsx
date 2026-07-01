"use client";

import * as React from "react";
import { GradientBtn } from "@/frontend/components/brand";
import { Confetti } from "./confetti";

/**
 * SuccessOverlay — the celebratory "pantalla de éxito" shown over the phone after
 * a key action (sign, pay, upload, submit). Animated check + confetti + a single
 * CTA to continue. Lives inside the phone-frame (absolute fill).
 */
export interface SuccessOverlayProps {
  title: string;
  body: string;
  continueLabel: string;
  onContinue: () => void;
  confetti?: boolean;
}

function SuccessCheck() {
  return (
    <div
      className="demo-pop"
      style={{
        width: 84,
        height: 84,
        margin: "0 auto",
        borderRadius: 999,
        background: "var(--green-soft)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <svg width="46" height="46" viewBox="0 0 46 46" fill="none" aria-hidden>
        <circle cx="23" cy="23" r="21" stroke="var(--green)" strokeWidth="3" opacity="0.25" />
        <path
          d="M14 24 L20 30 L33 16"
          stroke="var(--green)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 40,
            strokeDashoffset: 40,
            animation: "demo-check .5s .2s cubic-bezier(.2,.9,.3,1) forwards",
          }}
        />
      </svg>
    </div>
  );
}

export function SuccessOverlay({
  title,
  body,
  continueLabel,
  onContinue,
  confetti = true,
}: SuccessOverlayProps) {
  return (
    <div
      className="demo-overlay"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 22,
        background: "color-mix(in srgb, var(--brand-navy) 45%, transparent)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
      }}
    >
      {confetti && <Confetti />}
      <div
        className="demo-sheet"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 320,
          background: "var(--card)",
          borderRadius: 24,
          padding: "30px 24px 24px",
          boxShadow: "0 24px 60px rgba(11,27,51,0.30)",
          textAlign: "center",
        }}
      >
        <SuccessCheck />
        <h3 className="t-black" style={{ margin: "16px 0 0", fontSize: 21, color: "var(--navy)" }}>
          {title}
        </h3>
        <p style={{ margin: "8px 0 18px", fontSize: 15, color: "var(--ink-2)", lineHeight: 1.5 }}>
          {body}
        </p>
        <GradientBtn icon="check" size="md" onClick={onContinue}>
          {continueLabel}
        </GradientBtn>
      </div>
    </div>
  );
}
