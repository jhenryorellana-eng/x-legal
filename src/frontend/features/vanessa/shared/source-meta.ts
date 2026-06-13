/**
 * Pure (server-safe) presentational helpers for the Vanessa panel (DOC-52).
 *
 * These are framework-agnostic data maps and formatters — NO React, NO
 * "use client". They live in their own module so Server Components (e.g.
 * ventas/leads/page.tsx) can call them without crossing the client boundary.
 * The "use client" ui.tsx re-exports them for backward compatibility, so
 * existing client imports keep working unchanged.
 */

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
