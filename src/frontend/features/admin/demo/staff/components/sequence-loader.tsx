"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand";
import type { DemoLoaderStep } from "../../scenarios/types";

/**
 * SequenceLoader — the shared shell for every staff AI micro-experience. It shows
 * a custom `visual` (assembly, AI core, robot…) above a checklist of narration
 * steps that tick off one by one, plus a progress bar, then calls `onComplete`.
 *
 * Self-timed: all timeouts are scheduled on mount and cleared on unmount, so
 * resetting the demo (which unmounts the loader) can never fire a stale
 * completion. `onComplete` is read through a ref so a changing callback identity
 * doesn't reschedule the sequence.
 */
export interface SequenceLoaderProps {
  title: string;
  steps: DemoLoaderStep[];
  onComplete: () => void;
  /** Institutional accent for the progress bar + active step. */
  accent?: string;
  /** Milliseconds per step (default 1050). */
  stepMs?: number;
  /** Pause after the last step before completing (default 750). */
  holdMs?: number;
  /** Custom animated visual rendered above the checklist. */
  visual?: React.ReactNode;
}

export function SequenceLoader({
  title,
  steps,
  onComplete,
  accent = "var(--accent)",
  stepMs = 1050,
  holdMs = 750,
  visual,
}: SequenceLoaderProps) {
  const [active, setActive] = React.useState(0); // number of completed steps
  const onCompleteRef = React.useRef(onComplete);
  onCompleteRef.current = onComplete;

  React.useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < steps.length; i++) {
      timers.push(setTimeout(() => setActive(i + 1), stepMs * (i + 1)));
    }
    timers.push(setTimeout(() => onCompleteRef.current(), stepMs * steps.length + holdMs));
    return () => timers.forEach(clearTimeout);
  }, [steps, stepMs, holdMs]);

  const pct = Math.round((active / steps.length) * 100);

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
          width: "min(600px, calc(100vw - 24px))",
          maxHeight: "calc(100vh - 40px)",
          overflowY: "auto",
          background: "var(--card)",
          borderRadius: 24,
          padding: "22px 22px 20px",
          boxShadow: "0 30px 70px rgba(11,27,51,0.36)",
        }}
      >
        {visual}

        <h3
          className="t-black"
          style={{ margin: "18px 0 2px", fontSize: 19, color: "var(--navy)", textAlign: "center" }}
        >
          {title}
        </h3>

        {/* Progress bar */}
        <div
          style={{
            height: 8,
            borderRadius: 999,
            background: "var(--line)",
            overflow: "hidden",
            margin: "14px 0 16px",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              borderRadius: 999,
              background: `linear-gradient(90deg, ${accent}, var(--gold))`,
              transition: "width .5s cubic-bezier(.2,.9,.3,1)",
            }}
          />
        </div>

        {/* Steps checklist */}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {steps.map((step, i) => {
            const done = i < active;
            const running = i === active;
            return (
              <li
                key={step.text}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  opacity: done || running ? 1 : 0.42,
                  transition: "opacity .3s ease",
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    flexShrink: 0,
                    display: "grid",
                    placeItems: "center",
                    background: done
                      ? "var(--green-soft)"
                      : running
                        ? "var(--blue-soft)"
                        : "var(--bg)",
                    border: running ? `1px solid color-mix(in srgb, ${accent} 40%, transparent)` : "1px solid var(--line)",
                  }}
                >
                  {done ? (
                    <Icon name="check" size={15} color="var(--green)" stroke={3} />
                  ) : running ? (
                    <span
                      style={{
                        width: 13,
                        height: 13,
                        borderRadius: 999,
                        border: `2.5px solid color-mix(in srgb, ${accent} 32%, transparent)`,
                        borderTopColor: accent,
                        animation: "demo-spin .7s linear infinite",
                      }}
                    />
                  ) : (
                    <Icon name={step.icon} size={14} color="var(--ink-3)" />
                  )}
                </span>
                <span
                  style={{
                    fontSize: 14.5,
                    fontWeight: running ? 800 : 700,
                    color: done ? "var(--ink-2)" : running ? "var(--navy)" : "var(--ink-3)",
                    fontFamily: running ? "var(--font-title)" : undefined,
                  }}
                >
                  {step.text}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
