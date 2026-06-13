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

export type LeadSource = "tiktok" | "web" | "whatsapp" | "voz" | "ref" | string;

export const SOURCE_META: Record<
  string,
  { labelKey: string; icon: string; cls: string }
> = {
  tiktok: { labelKey: "tiktok", icon: "music_note", cls: "src-tiktok" },
  web: { labelKey: "web", icon: "language", cls: "src-web" },
  whatsapp: { labelKey: "whatsapp", icon: "chat", cls: "src-whatsapp" },
  voz: { labelKey: "voz", icon: "graphic_eq", cls: "src-voz" },
  voice: { labelKey: "voz", icon: "graphic_eq", cls: "src-voz" },
  ref: { labelKey: "ref", icon: "group", cls: "src-ref" },
  referral: { labelKey: "ref", icon: "group", cls: "src-ref" },
};

export function sourceMeta(source: string) {
  return SOURCE_META[source] ?? SOURCE_META.web;
}

/** RF-VAN-013 time-badge tier from minutes since lead creation. */
export function timeTier(minutes: number): "time-ok" | "time-warn" | "time-hot" {
  if (minutes > 30) return "time-hot";
  if (minutes >= 5) return "time-warn";
  return "time-ok";
}

export function fmtMoney(cents: number, locale: "es" | "en" = "es"): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function fmtPercent(value: number): string {
  return `${Math.round(value)}%`;
}

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
