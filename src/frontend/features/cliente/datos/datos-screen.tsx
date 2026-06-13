import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/frontend/components/brand/icon";
import { IconTile } from "@/frontend/components/brand/icon-tile";

/**
 * DatosScreen — `/caso/[caseId]/datos` (DOC-51 §24, prototype `screens8.jsx →
 * CaseDataScreen`). Read-only case details. Server-safe (no interactivity).
 */

export interface DatosRow {
  icon: IconName;
  color: string;
  label: string;
  value: string;
}

export function DatosScreen({
  caseId,
  title,
  back,
  rows,
}: {
  caseId: string;
  title: string;
  back: string;
  rows: DatosRow[];
}) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 20px 116px",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <Link
        href={`/caso/${caseId}/mas`}
        className="mp-tap"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--accent)",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 15,
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        <Icon name="chevL" size={18} color="var(--accent)" /> {back}
      </Link>
      <h1
        className="t-black"
        style={{ margin: "0 0 18px", fontSize: 27, color: "var(--navy)", textWrap: "balance" }}
      >
        {title}
      </h1>
      <div
        style={{
          background: "var(--card)",
          borderRadius: 20,
          padding: "4px 16px",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 0",
              borderTop: i ? "1px solid var(--line)" : "none",
            }}
          >
            <IconTile name={r.icon} color={r.color} size={42} radius={12} iconSize={22} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 700 }}>
                {r.label}
              </div>
              <div
                className="t-title"
                style={{ fontSize: 16, color: "var(--navy)", fontWeight: 700 }}
              >
                {r.value}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
