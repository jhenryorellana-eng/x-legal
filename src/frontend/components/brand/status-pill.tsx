import * as React from "react";
import { Icon, type IconName } from "./icon";

/**
 * StatusPill (DOC-01 §5.1).
 * Pill 999px, padding 7×13, icon + 14px bold text. Color carries meaning but is
 * always paired with an icon + label (DOC-01 §8.4).
 *
 * Variants: aprobado · revision · pendiente · corregir · hecho.
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
}

export function StatusPill({ kind, children }: StatusPillProps) {
  const s = STATUS_MAP[kind];
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
