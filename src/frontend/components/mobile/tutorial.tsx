"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Lex } from "@/frontend/components/brand/lex";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";

/**
 * Tutorial — coach-mark overlay con Lex (DOC-01 §5.2, DOC-51 §O3, DOC-29).
 * Ported from the prototype `V2/UI Cliente/app/screens1.jsx → Tutorial`.
 *
 * For each step: a dimmed veil, an optional spotlight (a clear cutout around a
 * target element, pulsing with `spotPulse`), and a bubble with Lex 92px (mood
 * `señala`), the step title/body, gold progress dots, and Skip / Next-Got it.
 *
 * Positioning (DOC-29 §33/§35): the overlay is rendered via a portal into
 * `document.body` as a **fixed**, viewport-anchored layer constrained to the
 * 430px app column. Targets are resolved by CSS selector (`step.target`) and
 * measured with `getBoundingClientRect` in viewport coordinates, so the tour can
 * spotlight elements that live OUTSIDE the screen's React tree (e.g. the fixed
 * "Tu equipo" launcher in the case chrome) and stays glued to them. Scroll is
 * locked while the tour is open, so nothing drifts. When a target is missing or
 * off-screen, the step shows a plain bubble with no spotlight. Respects
 * `prefers-reduced-motion` via the CSS utility classes.
 */

/** App content column width (keep in sync with the cliente surface / bottom-nav). */
const COLUMN_MAX = 430;
/** Extra gap kept between the spotlight and the bubble / the veil edge. */
const SPOT_PAD = 6;

export interface TutorialStep {
  title: string;
  body: string;
  /** CSS selector of the element to spotlight for this step (e.g. `[data-tour="next-step"]`). */
  target?: string;
}

export interface TutorialLabels {
  skip: string;
  next: string;
  done: string;
}

export interface TutorialProps {
  open: boolean;
  steps: TutorialStep[];
  labels: TutorialLabels;
  onClose: () => void;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function Tutorial({ open, steps, labels, onClose }: TutorialProps) {
  const [mounted, setMounted] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [rect, setRect] = React.useState<Rect | null>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const total = steps.length;

  // Portal target only exists on the client.
  React.useEffect(() => setMounted(true), []);

  // Reset to the first step each time the tutorial opens.
  React.useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // Lock page scroll while the tour is open so the spotlight never drifts.
  React.useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, [open]);

  // Measure the current step's target in viewport coords, relative to the fixed
  // overlay container. Off-screen / missing target → no spotlight (DOC-29 §35).
  const measure = React.useCallback(() => {
    const sel = steps[step]?.target;
    const overlay = overlayRef.current;
    if (!sel || !overlay) {
      setRect(null);
      return;
    }
    const target = document.querySelector(sel);
    if (!target) {
      setRect(null);
      return;
    }
    const tr = target.getBoundingClientRect();
    const onScreen =
      tr.width > 0 &&
      tr.height > 0 &&
      tr.bottom > 0 &&
      tr.top < window.innerHeight &&
      tr.right > 0 &&
      tr.left < window.innerWidth;
    if (!onScreen) {
      setRect(null);
      return;
    }
    const or = overlay.getBoundingClientRect();
    setRect({
      left: tr.left - or.left,
      top: tr.top - or.top,
      width: tr.width,
      height: tr.height,
    });
  }, [step, steps]);

  // Re-measure on open, step change, resize and scroll (scroll is locked, but a
  // late layout pass or momentum can still nudge things — stay glued).
  React.useEffect(() => {
    if (!open || !mounted) return;
    setRect(null);
    const id = window.setTimeout(measure, 80);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, mounted, step, measure]);

  // Escape closes (= "Saltar").
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open || total === 0) return null;

  const tip = steps[step] ?? steps[0];
  const last = step >= total - 1;
  const next = () => {
    if (last) onClose();
    else setStep((s) => s + 1);
  };

  // Keep the bubble from covering the spotlight: if the target sits in the lower
  // part of the viewport (e.g. the bottom-left launcher), anchor the bubble just
  // above it; otherwise dock it at the bottom.
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 874;
  const spotlightIsLow = rect != null && rect.top + rect.height / 2 > viewportH * 0.55;
  const bubbleBottom = spotlightIsLow ? Math.round(viewportH - rect!.top + SPOT_PAD + 10) : 36;

  return createPortal(
    <div
      ref={overlayRef}
      style={{
        position: "fixed",
        top: 0,
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: `min(100vw, ${COLUMN_MAX}px)`,
        zIndex: 200,
      }}
    >
      {rect ? (
        <>
          {/* Transparent click-blocker: keeps the page behind inert while the
              spotlight cutout stays visually clear. */}
          <div aria-hidden="true" style={{ position: "absolute", inset: 0 }} />
          {/* Spotlight cutout — the giant box-shadow IS the veil. */}
          <div
            aria-hidden="true"
            className="anim-spot-pulse"
            style={{
              position: "absolute",
              left: rect.left - SPOT_PAD,
              top: rect.top - SPOT_PAD,
              width: rect.width + SPOT_PAD * 2,
              height: rect.height + SPOT_PAD * 2,
              borderRadius: 28,
              boxShadow: "0 0 0 9999px rgba(7,17,33,0.62)",
              pointerEvents: "none",
            }}
          />
        </>
      ) : (
        <div
          aria-hidden="true"
          className="anim-fade-in"
          style={{ position: "absolute", inset: 0, background: "rgba(7,17,33,0.62)" }}
        />
      )}

      {/* Bubble */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tip.title}
        className="anim-fade-in-up"
        style={{ position: "absolute", left: 18, right: 18, bottom: bubbleBottom }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 6,
            marginBottom: -8,
            marginLeft: 8,
          }}
        >
          <Lex size={92} mood="señala" />
        </div>
        <div
          style={{
            background: "var(--card)",
            borderRadius: 22,
            padding: 20,
            boxShadow: "0 20px 50px rgba(0,0,0,0.4)",
          }}
        >
          <h3
            className="t-title"
            style={{ margin: 0, fontSize: 21, color: "var(--navy)", fontWeight: 700 }}
          >
            {tip.title}
          </h3>
          <p
            style={{
              margin: "8px 0 16px",
              fontSize: 16,
              color: "var(--ink-2)",
              lineHeight: 1.5,
              fontWeight: 500,
            }}
          >
            {tip.body}
          </p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {/* Progress dots */}
            <div style={{ display: "flex", gap: 7 }} aria-hidden="true">
              {Array.from({ length: total }).map((_, i) => (
                <span
                  key={i}
                  style={{
                    width: i === step ? 22 : 8,
                    height: 8,
                    borderRadius: 999,
                    background: i === step ? "var(--gold)" : "var(--line)",
                    transition: "all 0.3s var(--ease)",
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--ink-3)",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                  fontFamily: "var(--font-title)",
                }}
              >
                {labels.skip}
              </button>
              <GradientBtn onClick={next} full={false} size="sm">
                {last ? labels.done : labels.next}
              </GradientBtn>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
