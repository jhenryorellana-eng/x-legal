/**
 * Flat string map for the public signing surface (DOC-51 §27).
 *
 * The page is anonymous and has no `users.locale`; the locale is derived from
 * `Accept-Language` (DOC-50 §1.2). The `publicSigning.*` namespace lives in the
 * canonical es.json/en.json; this builder reads it directly (the surface is a
 * Server Component that needs a plain string map, not a hook).
 */

import es from "@/frontend/i18n/messages/es.json";
import en from "@/frontend/i18n/messages/en.json";

export type SigningLocale = "es" | "en";

export type SigningStrings = (typeof es)["publicSigning"];

export function buildSigningStrings(locale: SigningLocale): SigningStrings {
  return (locale === "en" ? en : es).publicSigning;
}

/** Derives es|en from an Accept-Language header (default es). */
export function localeFromAcceptLanguage(header: string | null): SigningLocale {
  if (!header) return "es";
  const first = header.toLowerCase().split(",")[0]?.trim() ?? "";
  return first.startsWith("en") ? "en" : "es";
}
