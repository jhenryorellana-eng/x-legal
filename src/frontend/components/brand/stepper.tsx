import * as React from "react";
import { Icon } from "./icon";

/**
 * Stepper (DOC-01 §5.1).
 * Steps with a 38–48px dot:
 *  - done    → green + check
 *  - current → accent + glow + `ringPulse`
 *  - upcoming→ outline, `lock` if blocked, opacity .66
 * Connectors are `--line` (green when the prior step is done).
 */

export type StepState = "done" | "current" | "upcoming";

export interface Step {
  id: string;
  label: string;
  state: StepState;
  /** Show a lock glyph on an upcoming step. */
  locked?: boolean;
}

export interface StepperProps {
  steps: Step[];
  orientation?: "horizontal" | "vertical";
}

export function Stepper({ steps, orientation = "vertical" }: StepperProps) {
  const horizontal = orientation === "horizontal";
  return (
    <ol
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: horizontal ? "row" : "column",
        gap: 0,
      }}
    >
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const prevDone = steps[i].state === "done";
        return (
          <li
            key={step.id}
            style={{
              display: "flex",
              flexDirection: horizontal ? "column" : "row",
              alignItems: "center",
              gap: horizontal ? 8 : 12,
              flex: horizontal ? 1 : undefined,
              opacity: step.state === "upcoming" ? 0.66 : 1,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: horizontal ? "row" : "column",
                alignItems: "center",
                alignSelf: horizontal ? "stretch" : undefined,
                width: horizontal ? "100%" : 44,
                justifyContent: horizontal ? "center" : undefined,
              }}
            >
              <Dot step={step} />
              {!last && (
                <span
                  aria-hidden="true"
                  className={horizontal ? undefined : undefined}
                  style={
                    horizontal
                      ? {
                          flex: 1,
                          height: 2,
                          margin: "0 6px",
                          background: prevDone
                            ? "var(--green)"
                            : "var(--line)",
                          borderRadius: 999,
                        }
                      : {
                          flex: 1,
                          width: 2,
                          minHeight: 26,
                          marginTop: 4,
                          background: prevDone
                            ? "var(--green)"
                            : "var(--line)",
                          borderRadius: 999,
                        }
                  }
                />
              )}
            </div>
            <span
              style={{
                fontFamily: "var(--font-title)",
                fontWeight: step.state === "current" ? 800 : 700,
                fontSize: horizontal ? 12.5 : 15,
                color:
                  step.state === "current" ? "var(--ink)" : "var(--ink-2)",
                textAlign: horizontal ? "center" : "left",
                paddingBottom: horizontal ? 0 : last ? 0 : 14,
              }}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Dot({ step }: { step: Step }) {
  const base: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  };

  if (step.state === "done") {
    return (
      <span
        style={{
          ...base,
          background: "var(--green)",
          boxShadow: "0 6px 16px color-mix(in srgb, var(--green) 35%, transparent)",
        }}
      >
        <Icon name="check" size={20} color="#fff" stroke={2.8} />
      </span>
    );
  }

  if (step.state === "current") {
    return (
      <span
        className="anim-ring-pulse"
        style={{
          ...base,
          background: "var(--accent)",
          boxShadow:
            "0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent), 0 10px 26px color-mix(in srgb, var(--accent) 35%, transparent)",
          color: "#fff",
          fontFamily: "var(--font-title)",
          fontWeight: 900,
          fontSize: 16,
        }}
      >
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#fff" }} />
      </span>
    );
  }

  // upcoming
  return (
    <span
      style={{
        ...base,
        background: "var(--card)",
        border: "2px solid var(--line)",
      }}
    >
      {step.locked ? (
        <Icon name="lock" size={18} color="var(--ink-3)" />
      ) : (
        <span
          style={{ width: 10, height: 10, borderRadius: 999, background: "var(--ink-3)" }}
        />
      )}
    </span>
  );
}
