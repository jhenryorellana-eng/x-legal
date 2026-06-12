"use client";

import * as React from "react";
import { Icon, type IconName } from "./icon";

/**
 * GradientBtn — primary button (DOC-01 §5.1).
 * Heights 60/52/46 (lg/md/sm), pill. Fill `linear-gradient(125deg, c1, c2)`
 * (default accent → accent-deep). Glossy top sheen + a light reflection that
 * sweeps every 5s (`reflect`). Hover lifts −2px, glows and cycles the gradient
 * blue↔gold. Press `scale(0.972)`. Disabled `opacity .45`.
 */

export interface GradientBtnProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  icon?: IconName;
  /** Gradient start (default brand grad-c1 / accent). */
  c1?: string;
  /** Gradient end (default brand grad-c2 / accent-deep). */
  c2?: string;
  full?: boolean;
  size?: "lg" | "md" | "sm";
  /** Continuously cycle the blue↔gold gradient even without hover. */
  animated?: boolean;
}

export function GradientBtn({
  children,
  icon,
  c1,
  c2,
  full = true,
  size = "lg",
  animated = false,
  disabled = false,
  style,
  onClick,
  ...rest
}: GradientBtnProps) {
  const a = c1 || "var(--accent)";
  const b = c2 || "var(--accent-deep)";
  const ax = (p: number) => `color-mix(in srgb, ${a} ${p}%, transparent)`;
  const h = size === "lg" ? 60 : size === "md" ? 52 : 46;
  const [press, setPress] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const live = !disabled && (animated || hover); // azul ↔ dorado cycle

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPress(false);
      }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      onTouchStart={() => setPress(true)}
      onTouchEnd={() => setPress(false)}
      style={{
        position: "relative",
        width: full ? "100%" : "auto",
        height: h,
        border: "none",
        borderRadius: 999,
        padding: full ? "0 22px" : "0 32px",
        cursor: disabled ? "default" : "pointer",
        background: live
          ? "linear-gradient(90deg, var(--accent) 0%, var(--accent) 28%, var(--gold) 72%, var(--gold-deep) 100%)"
          : `linear-gradient(125deg, ${a} 0%, ${b} 100%)`,
        color: "var(--on-accent, #fff)",
        fontFamily: "var(--font-title)",
        fontWeight: 800,
        fontSize: size === "lg" ? 19 : 17,
        letterSpacing: "-0.01em",
        overflow: "hidden",
        boxShadow: disabled
          ? "none"
          : hover
            ? `0 16px 34px ${ax(48)}, 0 6px 16px ${ax(40)}, inset 0 1px 0 rgba(255,255,255,0.42)`
            : `0 10px 24px ${ax(38)}, 0 4px 10px ${ax(30)}, inset 0 1px 0 rgba(255,255,255,0.34)`,
        opacity: disabled ? 0.45 : 1,
        transform: press
          ? "translateY(0) scale(0.972)"
          : hover
            ? "translateY(-2px) scale(1.015)"
            : "translateY(0) scale(1)",
        transition:
          "transform 0.2s cubic-bezier(.2,.9,.3,1), box-shadow 0.3s ease, background 0.35s ease",
        willChange: "transform",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        ...style,
      }}
      {...rest}
    >
      {/* glossy top sheen */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: "46%",
          borderRadius: "999px 999px 60% 60%",
          background:
            "linear-gradient(rgba(255,255,255,0.4), rgba(255,255,255,0))",
          pointerEvents: "none",
        }}
      />
      {/* light reflection sweeping across every 5s */}
      {!disabled && (
        <span
          aria-hidden="true"
          className="anim-reflect"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: "42%",
            left: 0,
            background:
              "linear-gradient(100deg, transparent, rgba(255,255,255,0.55), transparent)",
            pointerEvents: "none",
          }}
        />
      )}
      {icon && (
        <span
          style={{
            position: "relative",
            display: "flex",
            transform: hover ? "scale(1.08)" : "scale(1)",
            transition: "transform 0.2s cubic-bezier(.2,.9,.3,1)",
          }}
        >
          <Icon name={icon} size={22} color="#fff" stroke={2.4} />
        </span>
      )}
      <span
        style={{
          position: "relative",
          whiteSpace: "nowrap",
          textShadow: hover ? "0 1px 4px rgba(0,0,0,0.6)" : "none",
          transition: "text-shadow 0.2s ease",
        }}
      >
        {children}
      </span>
    </button>
  );
}
