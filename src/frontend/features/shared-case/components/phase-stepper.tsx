import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";

/**
 * Phase stepper rendered with the staff `.stepper` design classes (vanessa.css).
 * States derive from the real `phaseIndex`/`phaseCount` of getCaseWorkspace.
 */
export function PhaseStepper({
  index,
  count,
  currentLabel,
  phaseWord,
}: {
  index: number;
  count: number;
  currentLabel: string | null;
  phaseWord: string;
}) {
  if (count <= 0) return null;
  const steps = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const state: "done" | "cur" | "up" = n < index ? "done" : n === index ? "cur" : "up";
    return { n, state };
  });
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <React.Fragment key={s.n}>
          <div className={`step ${s.state === "done" ? "done" : s.state === "cur" ? "cur" : ""}`}>
            <div className="step-dot">
              {s.state === "done" ? <Icon name="check" size={18} color="#fff" /> : s.n}
            </div>
            <div className="step-lbl">
              {s.n === index && currentLabel ? currentLabel : `${phaseWord} ${s.n}`}
            </div>
          </div>
          {i < steps.length - 1 && (
            <div className={`step-line ${s.state === "done" ? "done" : ""}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
