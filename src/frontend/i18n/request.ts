// next-intl request config — DOC-23 §2.1, "without i18n routing" mode.
// The locale is NOT a URL dimension (no /es/... or /en/... routes): it is a
// user preference (users.locale). The `ulp-locale` / `ulp-tz` cookies are
// operational mirrors written at login and on settings change, so SSR renders
// in the right language/timezone without frontend/ importing backend/.
import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import type { Locale } from "@/shared/i18n";

const SUPPORTED = ["es", "en"] as const;
const DEFAULT_LOCALE: Locale = "es";
const DEFAULT_TIMEZONE = "America/New_York"; // orgs default — mirror of users.timezone (DOC-23 §6.2)

function isSupported(value: string | undefined): value is Locale {
  return (
    value !== undefined && (SUPPORTED as readonly string[]).includes(value)
  );
}

/**
 * Minimal Accept-Language negotiation: entries ranked by q-value, matched by
 * base language (`es-MX` → `es`). Returns the fallback when nothing matches.
 */
function negotiate(
  header: string | null,
  supported: readonly Locale[],
  fallback: Locale,
): Locale {
  if (!header) return fallback;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      return {
        base: tag.trim().toLowerCase().split("-")[0],
        quality: q === undefined ? 1 : Number.parseFloat(q),
      };
    })
    .filter((e) => e.base && !Number.isNaN(e.quality) && e.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { base } of ranked) {
    const match = supported.find((locale) => locale === base);
    if (match) return match;
  }
  return fallback;
}

export default getRequestConfig(async () => {
  const jar = await cookies();
  // 1) operational cookie synced with users.locale (written at login and on
  //    settings change)
  // 2) pre-session fallback: Accept-Language negotiation
  // 3) default: 'es'
  const fromCookie = jar.get("ulp-locale")?.value;
  const locale = isSupported(fromCookie)
    ? fromCookie
    : negotiate(
        (await headers()).get("accept-language"),
        SUPPORTED,
        DEFAULT_LOCALE,
      );

  // Mirror of users.timezone (DOC-23 §6.2): next-intl formatters render in
  // the user's timezone.
  const timeZone = jar.get("ulp-tz")?.value ?? DEFAULT_TIMEZONE;

  return {
    locale,
    timeZone,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
