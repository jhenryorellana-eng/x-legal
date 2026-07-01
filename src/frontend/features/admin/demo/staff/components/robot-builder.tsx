"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand";

/**
 * RobotBuilder — the "disruptive" visual for expediente compilation: a friendly
 * robot (institutional blue/gold/white) that actively assembles: it bobs, swings
 * its arm, and a stream of sheets drops into a binder while its antenna sparks.
 * Pure CSS motion, loops continuously so it never looks frozen.
 */
export function RobotBuilder() {
  return (
    <div
      style={{
        position: "relative",
        height: 168,
        borderRadius: 18,
        overflow: "hidden",
        background:
          "radial-gradient(120% 90% at 20% 0%, var(--blue-soft) 0%, transparent 55%), radial-gradient(120% 90% at 100% 100%, var(--gold-soft) 0%, transparent 50%), var(--card)",
        border: "1px solid var(--line)",
      }}
    >
      {/* Scene */}
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <div style={{ position: "relative", width: 240, height: 140 }}>
          {/* Robot */}
          <div className="staff-bob" style={{ position: "absolute", left: 26, top: 24 }}>
            {/* Antenna + spark */}
            <span style={{ position: "absolute", left: 44, top: -12, width: 2, height: 12, background: "var(--brand-navy)", borderRadius: 2 }} />
            <span
              className="staff-spark"
              style={{ position: "absolute", left: 40, top: -20, width: 10, height: 10, borderRadius: 999, background: "var(--gold)", boxShadow: "0 0 10px var(--gold)" }}
            />
            {/* Head */}
            <div
              style={{
                position: "relative",
                width: 74,
                height: 52,
                borderRadius: 16,
                background: "#fff",
                border: "2px solid var(--brand-navy)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
              }}
            >
              <span style={{ width: 11, height: 11, borderRadius: 999, background: "var(--accent)" }} />
              <span style={{ width: 11, height: 11, borderRadius: 999, background: "var(--accent)" }} />
              {/* cheeks */}
              <span style={{ position: "absolute", left: 8, bottom: 12, width: 7, height: 4, borderRadius: 999, background: "var(--red-soft)" }} />
              <span style={{ position: "absolute", right: 8, bottom: 12, width: 7, height: 4, borderRadius: 999, background: "var(--red-soft)" }} />
            </div>
            {/* Body */}
            <div
              style={{
                position: "relative",
                width: 64,
                height: 46,
                margin: "5px auto 0",
                borderRadius: 13,
                background: "linear-gradient(135deg, var(--accent), var(--accent-deep))",
                display: "grid",
                placeItems: "center",
                boxShadow: "0 8px 18px color-mix(in srgb, var(--accent) 30%, transparent)",
              }}
            >
              <span style={{ width: 34, height: 26, borderRadius: 7, background: "color-mix(in srgb, #fff 88%, var(--gold-soft))", display: "grid", placeItems: "center" }}>
                <Icon name="doc" size={15} color="var(--brand-navy)" />
              </span>
              {/* Arm reaching toward the binder */}
              <span
                className="staff-arm"
                style={{ position: "absolute", right: -6, top: 4, width: 7, height: 30, borderRadius: 999, background: "var(--brand-navy)" }}
              />
            </div>
          </div>

          {/* Binder with dropping sheets */}
          <div style={{ position: "absolute", right: 20, bottom: 6, width: 92, height: 92 }}>
            {/* Dropping sheets */}
            {[0, 0.45, 0.9, 1.35].map((d, i) => (
              <span
                key={i}
                className="staff-sheet-drop"
                style={{
                  position: "absolute",
                  left: 20 + (i % 2) * 8,
                  top: 0,
                  width: 46,
                  height: 30,
                  borderRadius: 5,
                  background: "#fff",
                  border: "1px solid var(--line)",
                  boxShadow: "0 4px 10px rgba(11,27,51,0.16)",
                  animation: "staff-sheet-drop 1.8s ease-in-out infinite",
                  animationDelay: `${d}s`,
                }}
              />
            ))}
            {/* Binder / folder */}
            <div
              style={{
                position: "absolute",
                left: 6,
                bottom: 0,
                width: 80,
                height: 52,
                borderRadius: "6px 6px 12px 12px",
                background: "linear-gradient(135deg, var(--gold), var(--gold-deep))",
                boxShadow: "0 10px 20px color-mix(in srgb, var(--gold-deep) 30%, transparent)",
              }}
            >
              <span style={{ position: "absolute", left: 12, top: -5, width: 40, height: 10, borderRadius: "6px 6px 0 0", background: "var(--gold-deep)" }} />
              <span style={{ position: "absolute", left: "50%", top: 18, transform: "translateX(-50%)" }}>
                <Icon name="shield" size={18} color="#fff" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
