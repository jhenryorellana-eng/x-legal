import * as React from "react";

/**
 * Avatar (DOC-01 §5.1).
 * Circle with a brand gradient — `navy→accent` for staff, `gold→red` for the
 * user — and a white 900-weight initial. Optionally renders a photo.
 */

export type AvatarVariant = "staff" | "user";

const GRADIENT: Record<AvatarVariant, string> = {
  staff: "linear-gradient(135deg, var(--brand-navy), var(--accent))",
  user: "linear-gradient(135deg, var(--gold), var(--red))",
};

export interface AvatarProps {
  /** Full name; the first letter is shown when no `src`. */
  name: string;
  variant?: AvatarVariant;
  size?: number;
  src?: string;
  className?: string;
}

export function Avatar({
  name,
  variant = "user",
  size = 44,
  src,
  className,
}: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: src ? undefined : GRADIENT[variant],
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
        color: "#fff",
        fontFamily: "var(--font-title)",
        fontWeight: 900,
        fontSize: size * 0.42,
        boxShadow: "0 4px 12px rgba(11,27,51,0.18)",
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar may be a remote URL
        <img
          src={src}
          alt={name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}
