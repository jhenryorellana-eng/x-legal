// Shared i18n primitives — DOC-23 §3.1. Pure helpers importable from both
// backend and frontend (boundaries rule: everyone may depend on shared/).

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Shape of every `*_i18n` jsonb column in the data model ({es, en}, possibly
 * partial while in draft). DOC-23 names this `I18nText`; `I18nLabel` is the
 * canonical export.
 */
export type I18nLabel = Partial<Record<Locale, string>> &
  Record<string, string | undefined>;
export type I18nText = I18nLabel;

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/** Type guard: a plain object whose values are strings (or null/undefined). */
function isI18nLabel(value: unknown): value is I18nLabel {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => v == null || typeof v === "string")
  );
}

/**
 * Resolves a `{es, en}` jsonb to the requested locale.
 * Fallback chain (DOC-23 §3.1): locale → es → en → first non-empty value → ''.
 * Empty strings count as absent, so a partial translation (e.g. `en: ""`)
 * degrades to the available language instead of rendering blank.
 * Accepts `unknown` so raw jsonb from the DB can be passed without casting;
 * anything that is not an i18n object resolves to ''.
 */
export function resolveI18n(label: unknown, locale: Locale): string {
  if (!isI18nLabel(label)) return "";
  const nonEmpty = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  return (
    nonEmpty(label[locale]) ??
    nonEmpty(label.es) ??
    nonEmpty(label.en) ??
    Object.values(label).find((v) => typeof v === "string" && v.length > 0) ??
    ""
  );
}
