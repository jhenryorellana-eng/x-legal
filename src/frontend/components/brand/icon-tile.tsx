import * as React from "react";
import { Icon, type IconName } from "./icon";

/**
 * IconHalo + IconTile — tech-premium icon container (DOC-01 §5.1).
 * Ported verbatim from the prototype `V2/UI Cliente/app/ui.jsx → IconHalo / IconTile`.
 *
 * The prototype concatenated hex-alpha suffixes (`${color}2e`) onto raw hex.
 * Here `color` is usually a CSS token (`var(--accent)`), so we use `color-mix`
 * to fade it instead — same visual, token-safe across light/dark.
 *
 * Server-safe (no "use client"): pure presentational, reused across RSC screens.
 */

export interface IconHaloProps {
  color: string;
  size?: number;
  opacity?: number;
}

export function IconHalo({ color, size = 46, opacity = 0.85 }: IconHaloProps) {
  const mix = (p: number) => `color-mix(in srgb, ${color} ${p}%, transparent)`;
  return (
    <span
      className="mp-halo"
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: size * 1.5,
        height: size * 1.5,
        transform: "translate(-50%,-50%)",
        borderRadius: "50%",
        opacity,
        background: `radial-gradient(circle at 38% 32%, ${mix(50)} 0%, ${mix(20)} 42%, transparent 70%)`,
        pointerEvents: "none",
        filter: "blur(2px)",
      }}
    />
  );
}

export interface IconTileProps {
  name: IconName;
  color: string;
  size?: number;
  radius?: number;
  iconSize?: number;
  stroke?: number;
  style?: React.CSSProperties;
}

export function IconTile({
  name,
  color,
  size = 48,
  radius = 14,
  iconSize = 25,
  stroke = 2.2,
  style = {},
}: IconTileProps) {
  const mix = (p: number) => `color-mix(in srgb, ${color} ${p}%, transparent)`;
  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: `radial-gradient(circle at 36% 30%, ${mix(18)}, ${mix(7)} 70%)`,
        boxShadow: `inset 0 0 0 1px ${mix(15)}`,
        ...style,
      }}
    >
      <IconHalo color={color} size={size} opacity={0.55} />
      <span style={{ position: "relative", display: "flex" }}>
        <Icon name={name} size={iconSize} color={color} stroke={stroke} />
      </span>
    </div>
  );
}
