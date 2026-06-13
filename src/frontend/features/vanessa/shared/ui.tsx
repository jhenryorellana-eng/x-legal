"use client";

/**
 * Shared presentational helpers for the Vanessa panel (DOC-52).
 *
 * - source maps (icon + css class per lead source)
 * - time-badge tier (RF-VAN-013 thresholds: <5m ok · 5–30m warn · >30m hot)
 * - money / percent formatting (DOC-23 §5.3, region-qualified US convention)
 * - tiny Chip / SegButton primitives matching the prototype classes
 */

import * as React from "react";
import { MSym } from "./msym";

// Pure, server-safe helpers live in ./source-meta (no "use client"). We
// re-export them here so existing client imports from "./ui" keep working,
// while Server Components import directly from "./source-meta".
export {
  SOURCE_META,
  sourceMeta,
  timeTier,
  fmtMoney,
  fmtPercent,
} from "./source-meta";
export type { LeadSource } from "./source-meta";

export function Chip({
  tone = "neutral",
  icon,
  children,
  style,
}: {
  tone?: "neutral" | "blue" | "gold" | "green" | "amber" | "red";
  icon?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span className={`chip ${tone}`} style={style}>
      {icon && <MSym name={icon} size={15} />}
      {children}
    </span>
  );
}

export function SegBar<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string; icon?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="seg" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <MSym name={o.icon} size={17} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Avatar with initials from a display name. */
export function Initials({ name }: { name: string }): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
