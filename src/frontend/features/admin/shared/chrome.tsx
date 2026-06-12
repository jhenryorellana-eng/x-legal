"use client";

import * as React from "react";

/**
 * Shared admin chrome primitives (DOC-53 §0): the view-head (title + sub +
 * trailing slot) and a few small inputs/labels reused across the admin screens.
 * All visuals come from the desktop staff tokens (DOC-01 §3.3).
 */

export function ViewHead({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 14,
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginBottom: 20,
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-title)",
            fontWeight: 900,
            fontSize: 24,
            letterSpacing: "-0.02em",
            color: "var(--navy)",
          }}
        >
          {title}
        </h1>
        {sub && (
          <p style={{ margin: "5px 0 0", fontSize: 14, color: "var(--ink-2)" }}>
            {sub}
          </p>
        )}
      </div>
      {children && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "block",
        fontFamily: "var(--font-title)",
        fontWeight: 800,
        fontSize: 13,
        color: "var(--ink)",
        marginBottom: 6,
      }}
    >
      {children}
    </span>
  );
}

export const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 42,
  borderRadius: 12,
  border: "1.5px solid var(--line)",
  background: "var(--panel-2, var(--card-alt))",
  padding: "0 12px",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  color: "var(--ink)",
  outline: "none",
};

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean },
) {
  const { invalid, style, ...rest } = props;
  return (
    <input
      {...rest}
      style={{
        ...inputStyle,
        border: `1.5px solid ${invalid ? "var(--red)" : "var(--line)"}`,
        ...style,
      }}
    />
  );
}

export function SelectInput(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  const { style, children, ...rest } = props;
  return (
    <select
      {...rest}
      style={{
        ...inputStyle,
        cursor: "pointer",
        appearance: "none",
        ...style,
      }}
    >
      {children}
    </select>
  );
}

/** A pill tab row (DOC-53 §9 internal tabs, accent over accent-soft). */
export function PillTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        borderRadius: 14,
        background: "var(--chip)",
        flexWrap: "wrap",
      }}
    >
      {tabs.map((t) => {
        const on = active === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            style={{
              height: 36,
              padding: "0 16px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
              background: on ? "var(--accent-soft)" : "transparent",
              color: on ? "var(--accent)" : "var(--ink-2)",
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 13.5,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Role → chip color (DOC-53 §7: Admin dorado · Ventas azul · Paralegal verde · Finanzas púrpura). */
export const ROLE_COLOR: Record<string, { bg: string; fg: string }> = {
  admin: { bg: "var(--gold-soft)", fg: "var(--gold-deep)" },
  sales: { bg: "var(--blue-soft)", fg: "var(--accent)" },
  paralegal: { bg: "var(--green-soft)", fg: "var(--green)" },
  finance: { bg: "var(--purple-soft)", fg: "var(--purple)" },
};

export function RoleChip({ role, label }: { role: string; label: string }) {
  const c = ROLE_COLOR[role] ?? ROLE_COLOR.sales;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 24,
        padding: "0 10px",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        fontFamily: "var(--font-title)",
        fontWeight: 800,
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
