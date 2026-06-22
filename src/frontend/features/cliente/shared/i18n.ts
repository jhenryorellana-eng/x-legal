import { ICON_NAMES, type IconName } from "@/frontend/components/brand/icon";

/**
 * Shared helpers for the (cliente) feature pages.
 *
 * - `pickLocale`: resolves an `{en,es}` value for the active locale.
 * - `coerceIcon`: validates a catalog icon string against the brand icon set,
 *    falling back to a neutral default (admin-validated, but defensive).
 */

export type Locale = "es" | "en";

export interface I18nValue {
  en: string;
  es: string;
}

/** Resolves an i18n value for the active locale, with the other as fallback. */
export function pickLocale(value: I18nValue | null | undefined, locale: Locale): string {
  if (!value) return "";
  const primary = value[locale];
  if (primary) return primary;
  return locale === "es" ? value.en : value.es;
}

const ICON_SET = new Set<string>(ICON_NAMES);

/** Returns a valid IconName, falling back to `fallback` when the string is unknown. */
export function coerceIcon(name: string | null | undefined, fallback: IconName = "doc"): IconName {
  if (name && ICON_SET.has(name)) return name as IconName;
  return fallback;
}

/**
 * Catalog color token → CSS value. The admin editor stores a token name
 * (`accent`, `gold`, …, see admin catalog SERVICE_COLOR); the brand icon
 * components need a real CSS color (`var(--accent)`), so resolve it here. A
 * value that already looks like CSS (`var(...)` / `#hex`) passes through.
 */
const SERVICE_COLOR: Record<string, string> = {
  accent: "var(--accent)",
  gold: "var(--gold-deep)",
  green: "var(--green)",
  red: "var(--red)",
  navy: "var(--brand-navy)",
  purple: "var(--purple)",
};

export function coerceColor(color: string | null | undefined): string {
  if (!color) return "var(--accent)";
  if (color.startsWith("var(") || color.startsWith("#")) return color;
  return SERVICE_COLOR[color] ?? "var(--accent)";
}
