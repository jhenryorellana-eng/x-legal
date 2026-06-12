import * as React from "react";
import { Icon, type IconName } from "./icon";

/**
 * GhostBtn — secondary button (DOC-01 §5.1).
 * Border `2px solid color-mix(accent 20%)`, `card`/`panel` fill, `accent` text,
 * soft shadow. Heights 60/52 (lg/md), pill.
 */

export interface GhostBtnProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  icon?: IconName;
  size?: "lg" | "md";
  /** Text/border color; defaults to brand accent. */
  color?: string;
  full?: boolean;
}

export function GhostBtn({
  children,
  icon,
  size = "lg",
  color = "var(--accent)",
  full = true,
  disabled = false,
  style,
  ...rest
}: GhostBtnProps) {
  const h = size === "lg" ? 60 : 52;
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        width: full ? "100%" : "auto",
        height: h,
        borderRadius: 999,
        border: `2px solid color-mix(in srgb, ${color} 20%, transparent)`,
        background: "var(--card)",
        color,
        fontFamily: "var(--font-title)",
        fontWeight: 800,
        fontSize: size === "lg" ? 18 : 16,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        padding: full ? "0 22px" : "0 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        whiteSpace: "nowrap",
        boxShadow: "0 4px 12px rgba(11,27,51,0.05)",
        transition: "transform 0.18s var(--ease), box-shadow 0.18s var(--ease)",
        ...style,
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={21} color={color} />}
      {children}
    </button>
  );
}
