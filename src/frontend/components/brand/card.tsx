import * as React from "react";

/**
 * Card — brand surface (DOC-01 §5.1).
 * Radius 24px (móvil) / 20px (desktop, via `.surface-staff` token), padding
 * 18–20px, `card`/`panel` fill, `--shadow-soft`. When clickable it lifts on
 * hover. The optional `glow` tints the elevated shadow with a brand hue.
 */

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Brand hue used to tint the shadow (e.g. `var(--accent)`). */
  glow?: string;
  /** Renders hover-lift affordance (use when the card is interactive). */
  interactive?: boolean;
}

export function Card({
  children,
  glow,
  interactive = false,
  className,
  style,
  ...rest
}: CardProps) {
  return (
    <div
      className={className}
      data-interactive={interactive ? "" : undefined}
      style={{
        background: "var(--card)",
        borderRadius: "var(--r-lg)",
        padding: 18,
        boxShadow: glow
          ? `0 18px 40px color-mix(in srgb, ${glow} 15%, transparent), 0 4px 12px rgba(11,27,51,0.06)`
          : "var(--shadow-soft)",
        transition:
          "transform 0.18s var(--ease), box-shadow 0.18s var(--ease)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
