"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/frontend/components/brand/icon";
import { Lex } from "@/frontend/components/brand/lex";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { Confetti, playChime } from "@/frontend/components/mobile";

/**
 * ExitoScreen — `/caso/[caseId]/exito` (DOC-51 §16, prototype `screens2.jsx →
 * CelebrateScreen`). NO_CHROME.
 *
 * Confetti + chime fire ~150ms after mount (the component honors
 * prefers-reduced-motion: N=0 particles, silent). The progress + gain are real
 * (returned by confirmUploadAction, passed via query params by the page).
 */

export interface ExitoLabels {
  title: string; // "¡Lo lograste, {name}!"
  body: string;
  phaseProgress: string;
  continue: string;
}

export function ExitoScreen({
  caseId,
  displayName,
  progress,
  gain,
  labels,
}: {
  caseId: string;
  displayName: string;
  progress: number;
  gain: number;
  labels: ExitoLabels;
}) {
  const router = useRouter();
  const [run, setRun] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setRun(true);
      playChime();
    }, 150);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        minHeight: "100dvh",
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(120% 80% at 50% 18%, var(--card) 0%, var(--bg) 50%, var(--blue-soft) 100%)",
      }}
    >
      <Confetti run={run} />
      <div
        style={{
          position: "relative",
          zIndex: 2,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 30px 120px",
          textAlign: "center",
        }}
      >
        <div style={{ position: "relative" }}>
          <Lex size={186} mood="celebra" />
          <div
            style={{
              position: "absolute",
              bottom: -6,
              right: -10,
              width: 64,
              height: 64,
              borderRadius: 999,
              background: "var(--green)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow:
                "0 10px 26px color-mix(in srgb, var(--green) 40%, transparent), 0 0 0 8px color-mix(in srgb, var(--green) 13%, transparent)",
              animation: "checkPop 0.6s 0.3s cubic-bezier(.2,1.3,.4,1) both",
            }}
          >
            <Icon name="check" size={36} color="#fff" stroke={3.4} />
          </div>
        </div>
        <h1
          className="t-black"
          style={{
            margin: "26px 0 0",
            fontSize: 34,
            color: "var(--navy)",
            textWrap: "balance",
            animation: "fadeInUp 0.5s 0.3s both",
          }}
        >
          {labels.title.replace("{name}", displayName)}
        </h1>
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 17,
            color: "var(--ink-2)",
            lineHeight: 1.5,
            fontWeight: 500,
            maxWidth: 320,
            animation: "fadeInUp 0.5s 0.45s both",
          }}
        >
          {labels.body}
        </p>
        <div
          style={{
            marginTop: 22,
            background: "var(--card)",
            borderRadius: 20,
            padding: "14px 22px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            boxShadow: "var(--shadow-card)",
            animation: "softPop 0.5s 0.6s both",
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 999,
              background: "var(--gold-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="trophy" size={26} color="var(--gold-deep)" />
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 600 }}>
              {labels.phaseProgress}
            </div>
            <div
              className="t-title"
              style={{
                fontSize: 21,
                color: "var(--navy)",
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {progress}%{" "}
              {gain > 0 && (
                <span style={{ color: "var(--green)", fontSize: 15 }}>
                  ▲ +{gain}%
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          position: "fixed",
          left: 26,
          right: 26,
          bottom: 40,
          maxWidth: 378,
          margin: "0 auto",
          zIndex: 3,
          animation: "fadeInUp 0.5s 0.75s both",
        }}
      >
        <GradientBtn icon="chevR" onClick={() => router.push(`/caso/${caseId}/camino`)}>
          {labels.continue}
        </GradientBtn>
      </div>
    </div>
  );
}
