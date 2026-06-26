import * as React from "react";
import { Icon, type IconName } from "./icon";

/**
 * StatusPill (DOC-01 §5.1).
 * Pill 999px, padding 7×13, icon + 14px bold text. Color carries meaning but is
 * always paired with an icon + label (DOC-01 §8.4).
 *
 * Variants (color): aprobado · revision · pendiente · corregir · hecho.
 * `variant="subtle"` renders a colored dot + muted label (no pill background,
 * no icon) so a status never reads as a button — used in lists where it sits
 * next to real action buttons (e.g. the Documentos tab).
 */

export type StatusKind =
  | "aprobado"
  | "revision"
  | "pendiente"
  | "corregir"
  | "hecho";

interface StatusStyle {
  bg: string;
  fg: string;
  icon: IconName;
}

const STATUS_MAP: Record<StatusKind, StatusStyle> = {
  aprobado: { bg: "var(--green-soft)", fg: "var(--green)", icon: "check" },
  revision: { bg: "var(--gold-soft)", fg: "var(--gold-deep)", icon: "clock" },
  pendiente: { bg: "var(--blue-soft)", fg: "var(--accent)", icon: "upload" },
  corregir: { bg: "var(--red-soft)", fg: "var(--red)", icon: "info" },
  hecho: { bg: "var(--green-soft)", fg: "var(--green)", icon: "check" },
};

export interface StatusPillProps {
  kind: StatusKind;
  children: React.ReactNode;
  variant?: "solid" | "subtle";
}

export function StatusPill({ kind, children, variant = "solid" }: StatusPillProps) {
  const s = STATUS_MAP[kind];

  if (variant === "subtle") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          color: "var(--ink-2)",
          fontFamily: "var(--font-title)",
          fontWeight: 700,
          fontSize: 13.5,
          whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 8, height: 8, borderRadius: 999, background: s.fg, flexShrink: 0 }}
        />
        {children}
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: s.bg,
        color: s.fg,
        borderRadius: 999,
        padding: "7px 13px",
        fontFamily: "var(--font-title)",
        fontWeight: 800,
        fontSize: 14,
        whiteSpace: "nowrap",
      }}
    >
      <Icon name={s.icon} size={16} color={s.fg} stroke={2.6} />
      {children}
    </span>
  );
}
