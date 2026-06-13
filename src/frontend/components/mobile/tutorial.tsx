"use client";

import * as React from "react";
import { Lex } from "@/frontend/components/brand/lex";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";

/**
 * Tutorial — coach-mark overlay con Lex (DOC-01 §5.2, DOC-51 §0).
 * Ported from the prototype `V2/UI Cliente/app/screens1.jsx → Tutorial`.
 *
 * For each step: a dimmed scrim, an optional spotlight (cut around a target
 * element with `spotPulse`), and a bubble with Lex 92px (mood `señala`),
 * the step title/body, gold progress dots, and Skip / Next-Got it actions.
 *
 * The spotlight target is resolved from `steps[i].targetRef` measured relative
 * to `containerRef` (the phone frame). When no target is set, the step is a
 * plain centred bubble. Respects `prefers-reduced-motion` via the CSS utility
 * classes (`anim-spot-pulse`, `anim-fade-in`).
 */

export interface TutorialStep {
  title: string;
  body: string;
  /** Element to spotlight for this step. */
  targetRef?: React.RefObject<HTMLElement | null>;
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
  /** Frame the spotlight is measured against (defaults to the viewport). */
  containerRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function Tutorial({
  open,
  steps,
  labels,
  containerRef,
  onClose,
}: TutorialProps) {
  const [step, setStep] = React.useState(0);
  const [rect, setRect] = React.useState<Rect | null>(null);
  const total = steps.length;

  // Reset to the first step each time the tutorial opens.
  React.useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // Measure the spotlight target relative to the container.
  const measure = React.useCallback(() => {
    const target = steps[step]?.targetRef?.current;
    if (!target) {
      setRect(null);
      return;
    }
    const tr = target.getBoundingClientRect();
    const cont = containerRef?.current;
    const cr = cont?.getBoundingClientRect();
    setRect({
      left: tr.left - (cr?.left ?? 0),
      top: tr.top - (cr?.top ?? 0),
      width: tr.width,
      height: tr.height,
    });
  }, [step, steps, containerRef]);

  React.useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(measure, 80);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", measure);
    };
  }, [open, step, measure]);

  if (!open || total === 0) return null;

  const tip = steps[step] ?? steps[0];
  const last = step >= total - 1;
  const next = () => {
    if (last) onClose();
    else {
      setStep((s) => s + 1);
      setRect(null);
    }
  };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 60 }}>
      {/* Dimmed scrim (under the spotlight) */}
      <div
        className="anim-fade-in"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, background: "rgba(7,17,33,0.62)" }}
      />

      {/* Spotlight cutout around the target */}
      {rect && (
        <div
          aria-hidden="true"
          className="anim-spot-pulse"
          style={{
            position: "absolute",
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            borderRadius: 28,
            boxShadow: "0 0 0 9999px rgba(7,17,33,0.62)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Bubble */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tip.title}
        className="anim-fade-in-up"
        style={{ position: "absolute", left: 18, right: 18, bottom: 36 }}
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
            style={{
              margin: 0,
              fontSize: 21,
              color: "var(--navy)",
              fontWeight: 700,
            }}
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
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
    </div>
  );
}
