"use client";

import * as React from "react";
import { Icon, type IconName } from "@/frontend/components/brand";

export interface AiCounter {
  label: string;
  value: number;
}

/**
 * AiCoreVisual — the "disruptive" visual for the credible-fear memo generation: a
 * pulsing AI core (navy + gold + white — institutional) with orbiting particles
 * and a sweeping beam, over climbing counters (words / pages / citations). The
 * counters ease from 0 to their targets while the memo is "written".
 */
export function AiCoreVisual({ counters }: { counters: AiCounter[] }) {
  const [vals, setVals] = React.useState<number[]>(() => counters.map(() => 0));

  React.useEffect(() => {
    let frame = 0;
    const FRAMES = 46;
    const id = setInterval(() => {
      frame += 1;
      const t = Math.min(1, frame / FRAMES);
      const eased = 1 - Math.pow(1 - t, 3);
      setVals(counters.map((c) => Math.round(c.value * eased)));
      if (frame >= FRAMES) clearInterval(id);
    }, 55);
    return () => clearInterval(id);
  }, [counters]);

  return (
    <div>
      {/* Core panel */}
      <div
        style={{
          position: "relative",
          height: 168,
          borderRadius: 18,
          overflow: "hidden",
          background: "linear-gradient(140deg, var(--brand-navy) 0%, color-mix(in srgb, var(--brand-navy) 78%, var(--accent)) 100%)",
          display: "grid",
          placeItems: "center",
        }}
      >
        {/* Sweeping beam */}
        <span
          aria-hidden
          className="staff-beam"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: "46%",
            background: "linear-gradient(100deg, transparent, color-mix(in srgb, var(--gold) 40%, transparent), transparent)",
          }}
        />

        {/* Orbits */}
        <Orbit size={140} duration="7s" reverse={false} particles={["scale", "doc", "globe"]} />
        <Orbit size={98} duration="4.6s" reverse particles={["sparkle", "check"]} />

        {/* Core */}
        <div
          className="staff-core-pulse"
          style={{
            position: "relative",
            width: 62,
            height: 62,
            borderRadius: 18,
            background: "linear-gradient(135deg, #fff, var(--gold-soft))",
            display: "grid",
            placeItems: "center",
            zIndex: 2,
          }}
        >
          <Icon name="scale" size={30} color="var(--brand-navy)" />
        </div>
      </div>

      {/* Counters */}
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        {counters.map((c, i) => (
          <div
            key={c.label}
            style={{
              flex: 1,
              background: "var(--blue-soft)",
              borderRadius: 12,
              padding: "10px 8px",
              textAlign: "center",
            }}
          >
            <div className="t-black" style={{ fontSize: 19, color: "var(--navy)", lineHeight: 1 }}>
              {(vals[i] ?? 0).toLocaleString("en-US")}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--ink-2)", fontWeight: 700, marginTop: 3 }}>
              {c.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Orbit({
  size,
  duration,
  reverse,
  particles,
}: {
  size: number;
  duration: string;
  reverse: boolean;
  particles: IconName[];
}) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: "50%",
        border: "1px dashed color-mix(in srgb, #fff 22%, transparent)",
        animation: `${reverse ? "staff-orbit-rev" : "staff-orbit"} ${duration} linear infinite`,
      }}
    >
      {particles.map((p, i) => {
        const angle = (360 / particles.length) * i;
        return (
          <span
            key={p + i}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: 26,
              height: 26,
              marginLeft: -13,
              marginTop: -13,
              borderRadius: 8,
              background: "color-mix(in srgb, var(--gold) 92%, #fff)",
              display: "grid",
              placeItems: "center",
              transform: `rotate(${angle}deg) translateX(${size / 2}px) rotate(-${angle}deg)`,
              boxShadow: "0 4px 10px rgba(11,27,51,0.28)",
            }}
          >
            <Icon name={p} size={14} color="var(--brand-navy)" />
          </span>
        );
      })}
    </div>
  );
}
