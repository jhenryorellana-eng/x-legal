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
