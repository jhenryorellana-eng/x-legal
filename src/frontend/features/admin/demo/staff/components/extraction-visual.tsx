"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand";
import type { DemoDocExtract } from "../../scenarios/types";

/**
 * ExtractionVisual — the visual for the "Traducir" flow: a document page with a
 * scan line sweeping down it while the extracted key/values appear beside it (as
 * if the AI were reading the file). Purely presentational; the surrounding
 * SequenceLoader owns the timing.
 */
export function ExtractionVisual({
  extract,
  fieldsTitle,
}: {
  extract: DemoDocExtract[];
  fieldsTitle: string;
}) {
  const rows = extract.slice(0, 5);
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
      {/* Faux document with a sweeping scan line */}
      <div
        style={{
          position: "relative",
          width: 118,
          flexShrink: 0,
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "var(--card)",
          boxShadow: "var(--shadow-soft)",
          overflow: "hidden",
          padding: "12px 11px",
        }}
      >
        <Icon name="doc" size={18} color="var(--accent)" />
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {[92, 74, 84, 60, 80, 68, 88].map((w, i) => (
            <span
              key={i}
              style={{
                height: 5,
                width: `${w}%`,
                borderRadius: 999,
                background: "color-mix(in srgb, var(--ink-3) 26%, transparent)",
              }}
            />
          ))}
        </div>
        {/* Scan line */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 18,
            background:
              "linear-gradient(180deg, transparent, color-mix(in srgb, var(--accent) 34%, transparent), transparent)",
            borderTop: "2px solid var(--accent)",
            animation: "staff-scan 2.1s ease-in-out infinite",
          }}
        />
      </div>

      {/* Extracted fields */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 800,
            color: "var(--gold-deep)",
            textTransform: "uppercase",
            letterSpacing: 0.4,
            marginBottom: 8,
          }}
        >
          <Icon name="sparkle" size={13} color="var(--gold-deep)" /> {fieldsTitle}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {rows.map((r, i) => (
            <div
              key={r.field}
              className="staff-field-in"
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                background: "var(--blue-soft)",
                borderRadius: 9,
                padding: "6px 10px",
                animationDelay: `${0.35 + i * 0.4}s`,
              }}
            >
              <span style={{ fontSize: 11.5, color: "var(--ink-2)", fontWeight: 700, whiteSpace: "nowrap" }}>
                {r.field}
              </span>
              <span style={{ fontSize: 12, color: "var(--navy)", fontWeight: 800, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
