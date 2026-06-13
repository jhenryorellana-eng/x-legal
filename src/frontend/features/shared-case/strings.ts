/**
 * Flat string map for the shared-case workspace + admin casos list (DOC-53 §2/§3).
 *
 * Server pages build this plain map from the canonical es.json/en.json
 * `staff.casos.*` namespace (same buildStrings pattern as F1). Client components
 * stay presentational.
 */

import es from "@/frontend/i18n/messages/es.json";
import en from "@/frontend/i18n/messages/en.json";

export type CasosLocale = "es" | "en";

export type CasosStrings = (typeof es)["staff"]["casos"];

export function buildCasosStrings(locale: CasosLocale): CasosStrings {
  return (locale === "en" ? en : es).staff.casos;
}

/** Interpolates {placeholders} in a string. */
export function interp(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}
