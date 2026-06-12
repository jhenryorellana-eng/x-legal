import * as React from "react";
import { Icon, type IconName } from "@/frontend/components/brand/icon";

/**
 * KPI — staff dashboard metric card (DOC-01 §5.3).
 *
 * Card with a 40px IconTile, a 32px/900 value, a 13px ink-2 label and an
 * optional 12px trend (green ↑ / red ↓). The `hot` variant paints an
 * accent→navy gradient with white text, a glow and a decorative radial — used
 * for the headline KPI of each panel (e.g. "Casos activos", DOC-53 §1.1).
 *
 * Presentational only: every value arrives as a prop (DOC-50 §5).
 */

export interface KpiProps {
  icon: IconName;
  label: string;
  /** Pre-formatted value (the caller resolves money/percent formatting). */
  value: React.ReactNode;
  /** Optional trend; `dir` colours the arrow + text. */
  trend?: { dir: "up" | "down"; label: string };
  /** Headline KPI — accent→navy gradient, white text, glow. */
  hot?: boolean;
  /** Renders the click affordance (hover-lift + pointer). */
  onClick?: () => void;
  /** Accessible label for the actionable card (overrides the visible label). */
  "aria-label"?: string;
}

export function Kpi({
  icon,
  label,
  value,
  trend,
  hot = false,
  onClick,
  "aria-label": ariaLabel,
}: KpiProps) {
  const [hover, setHover] = React.useState(false);
  const clickable = typeof onClick === "function";

  const fg = hot ? "#fff" : "var(--ink)";
  const labelColor = hot ? "rgba(255,255,255,0.82)" : "var(--ink-2)";
  const trendColor = trend
    ? trend.dir === "up"
      ? hot
        ? "rgba(255,255,255,0.95)"
        : "var(--green)"
      : hot
        ? "rgba(255,255,255,0.92)"
        : "var(--red)"
    : undefined;

  const Tag = (clickable ? "button" : "div") as React.ElementType;

  return (
    <Tag
      type={clickable ? "button" : undefined}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={clickable ? (ariaLabel ?? label) : undefined}
      style={{
        position: "relative",
        textAlign: "left",
        width: "100%",
        border: hot ? "none" : "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        padding: 18,
        overflow: "hidden",
        cursor: clickable ? "pointer" : "default",
        background: hot
          ? "linear-gradient(135deg, var(--accent), var(--brand-navy))"
          : "var(--panel, var(--card))",
        color: fg,
        fontFamily: "var(--font-title)",
        boxShadow: hot
          ? hover
            ? "var(--glow), var(--shadow-md)"
            : "var(--glow), var(--shadow-sm)"
          : hover && clickable
            ? "var(--shadow-md)"
            : "var(--shadow-sm)",
        transform: hover && clickable ? "translateY(-3px)" : "translateY(0)",
        transition:
          "transform 0.16s var(--ease), box-shadow 0.16s var(--ease)",
        willChange: clickable ? "transform" : undefined,
      }}
    >
      {/* decorative radial for the hot variant */}
      {hot && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -40,
            right: -30,
            width: 160,
            height: 160,
            borderRadius: 999,
            background:
              "radial-gradient(circle, rgba(255,255,255,0.18), transparent 65%)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* IconTile 40px */}
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          display: "inline-grid",
          placeItems: "center",
          width: 40,
          height: 40,
          borderRadius: 12,
          marginBottom: 14,
          background: hot
            ? "rgba(255,255,255,0.16)"
            : "color-mix(in srgb, var(--accent) 12%, transparent)",
        }}
      >
        <Icon
          name={icon}
          size={22}
          color={hot ? "#fff" : "var(--accent)"}
          stroke={2.4}
        />
      </span>

      <div
        style={{
          position: "relative",
          fontSize: 32,
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          color: fg,
        }}
      >
        {value}
      </div>

      <div
        style={{
          position: "relative",
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: labelColor }}>
          {label}
        </span>
        {trend && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 12,
              fontWeight: 800,
              color: trendColor,
            }}
          >
            {trend.dir === "up" ? "↑" : "↓"} {trend.label}
          </span>
        )}
      </div>
    </Tag>
  );
}
