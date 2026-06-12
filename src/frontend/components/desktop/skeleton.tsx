import * as React from "react";

/**
 * Skeleton — staff loading block (DOC-01 §5.3).
 *
 * `--chip`-coloured block with a soft shimmer sweep. Used to mirror the shape
 * of the final content (KPI cards, table rows) during the initial RSC load
 * (DOC-53 §0.5 "Loading"). Respects prefers-reduced-motion via the shared
 * `.anim-shimmer` rule (motion.css).
 */

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  /** Circle helper (avatars / icon tiles). */
  circle?: boolean;
}

export function Skeleton({
  width = "100%",
  height = 14,
  radius,
  circle = false,
  style,
  className,
  ...rest
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "block",
        position: "relative",
        overflow: "hidden",
        width,
        height: circle ? width : height,
        borderRadius: circle ? 999 : (radius ?? 8),
        background: "var(--chip)",
        ...style,
      }}
      {...rest}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(100deg, transparent, color-mix(in srgb, #fff 38%, transparent), transparent)",
          animation: "shimmer 1.4s ease-in-out infinite",
          willChange: "transform",
        }}
      />
    </span>
  );
}
