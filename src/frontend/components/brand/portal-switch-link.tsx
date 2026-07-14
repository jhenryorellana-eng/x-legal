import Link from "next/link";

/**
 * PortalSwitchLink — subtle cross-portal navigation link.
 *
 * Lets a signed-out visitor who opened the wrong portal correct course:
 * client `/welcome` ⇄ staff `/login`. Deliberately low-emphasis so it never
 * competes with the primary CTAs, yet keeps a ≥40px touch target for a11y.
 *
 * Server-safe (no "use client"): usable from both Server Components
 * (`/welcome`) and Client Components (`/login`). Uses design-system tokens
 * (DOC-01), consistent with the other brand components.
 */

export interface PortalSwitchLinkProps {
  href: string;
  label: string;
}

export function PortalSwitchLink({ href, label }: PortalSwitchLinkProps) {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <Link
        href={href}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 40,
          padding: "8px 14px",
          fontFamily: "var(--font-body)",
          fontSize: 13.5,
          fontWeight: 600,
          color: "var(--ink-2)",
          textDecoration: "none",
          borderRadius: 12,
        }}
      >
        {label}
      </Link>
    </div>
  );
}
