"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand";
import { serviceColorToken } from "../scenarios";
import type { DemoPhase } from "../scenarios/types";

/**
 * PhaseSelector — the clickable phase stepper for multi-phase demos (Custodia →
 * I-360 → I-485). Shared by the client and staff walkthroughs. Selecting a phase
 * swaps the whole phase content (documents, forms, AI micro-experiences).
 *
 * Returns `null` for single-phase scenarios (Asilo, Apelación, …) so those demos
 * render exactly as before — one code path, no legacy branch. The real PWA
 * `PhaseStepper` is display-only; this one is interactive, hence a dedicated
 * component that borrows the visual language, not the code.
 *
 * States: past phases read "done" (green ✓), the active phase is filled with its
 * own accent, upcoming phases are muted. Every phase is clickable in the demo so
 * the presenter can jump around freely during the live.
 */
export function PhaseSelector({
  phases,
  activeIndex,
  onSelect,
  fallbackColor,
  ariaLabel,
}: {
  phases: DemoPhase[];
  activeIndex: number;
  onSelect: (index: number) => void;
  /** Service color token used when a phase declares no `color`. */
  fallbackColor: string;
  ariaLabel: string;
}) {
  if (phases.length <= 1) return null;

  return (
    <nav
      aria-label={ariaLabel}
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 4,
        overflowX: "auto",
        padding: "2px 2px 8px",
        marginBottom: 14,
        WebkitOverflowScrolling: "touch",
      }}
    >
      {phases.map((phase, i) => {
        const state: "done" | "active" | "upcoming" =
          i < activeIndex ? "done" : i === activeIndex ? "active" : "upcoming";
        const accent = phase.color ? serviceColorToken(phase.color) : fallbackColor;
        const isDone = state === "done";
        const isActive = state === "active";
        const dotBg = isDone ? "var(--green)" : isActive ? accent : "var(--panel-2, var(--bg))";
        const dotColor = isDone || isActive ? "#fff" : "var(--ink-3)";
        return (
          <React.Fragment key={phase.slug}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={isActive ? "step" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
                padding: "7px 12px 7px 8px",
                borderRadius: 999,
                cursor: "pointer",
                border: `1px solid ${isActive ? accent : "var(--line)"}`,
                background: isActive
                  ? `color-mix(in srgb, ${accent} 12%, var(--card))`
                  : "var(--card)",
                boxShadow: isActive ? `0 6px 16px color-mix(in srgb, ${accent} 22%, transparent)` : "none",
                transition: "background .2s var(--ease), border-color .2s var(--ease)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  background: dotBg,
                  color: dotColor,
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 12.5,
                  border: state === "upcoming" ? "1px solid var(--line)" : "none",
                }}
              >
                {isDone ? <Icon name="check" size={14} color="#fff" stroke={2.8} /> : i + 1}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 13.5,
                  whiteSpace: "nowrap",
                  color: isActive ? "var(--navy)" : isDone ? "var(--ink-2)" : "var(--ink-3)",
                }}
              >
                {phase.label}
              </span>
            </button>
            {i < phases.length - 1 && (
              <span
                aria-hidden
                style={{
                  alignSelf: "center",
                  flexShrink: 0,
                  width: 14,
                  height: 2,
                  borderRadius: 999,
                  background: i < activeIndex ? "var(--green)" : "var(--line)",
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
