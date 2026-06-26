/**
 * Centralized date/time formatting (DOC-23 §5, §6 · DOC-21 lib/ = "formato fecha/TZ").
 *
 * Every visible time is converted from a UTC instant to an explicit IANA
 * timezone with date-fns-tz — NEVER `toLocaleDateString()` desnudo nor manual
 * offset arithmetic (RNF-029/031). All helpers take `(instant, timeZone, locale)`
 * and never assume the device timezone (§6.3).
 *
 * Dual-hour pattern (staff panel, §6.5): the staff's own time is primary; when
 * the client's TZ differs a secondary chip shows the client's hour — both derived
 * from the SAME UTC instant via `formatInTimeZone`.
 */

import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { format, formatDistanceToNow } from "date-fns";
import { es as esLocale, enUS } from "date-fns/locale";

export type Locale = "es" | "en";

function dfLocale(locale: Locale) {
  return locale === "en" ? enUS : esLocale;
}

/** Friendly IANA → label dictionary (§5.2). Horas concretas usan zzz real. */
const TZ_LABEL: Record<string, { es: string; en: string }> = {
  "America/New_York": { es: "Florida (ET)", en: "Florida (ET)" },
  "America/Chicago": { es: "Centro (CT)", en: "Central (CT)" },
  // The org office lives in Utah (Mountain Time) — label the office/global
  // reference chip "Utah (MT)" to match the client app's `cityFromTz` ("Utah").
  "America/Denver": { es: "Utah (MT)", en: "Utah (MT)" },
  "America/Phoenix": { es: "Arizona (MST)", en: "Arizona (MST)" },
  "America/Los_Angeles": { es: "Pacífico (PT)", en: "Pacific (PT)" },
  "America/Bogota": { es: "Colombia (COT)", en: "Colombia (COT)" },
  "America/Mexico_City": { es: "Ciudad de México (CT)", en: "Mexico City (CT)" },
  "America/Guatemala": { es: "Centroamérica (CT)", en: "Central America (CT)" },
  "America/Santo_Domingo": { es: "Rep. Dominicana (AST)", en: "Dominican Republic (AST)" },
};

/** Friendly TZ label for static chips (e.g. "Florida (ET)"). */
export function tzLabel(timeZone: string, locale: Locale = "es"): string {
  const entry = TZ_LABEL[timeZone];
  if (entry) return entry[locale];
  // Fallback: short generic name from the city segment.
  return timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
}

/** Short timezone abbreviation for a concrete instant (EST/EDT/MST/…). */
export function tzAbbrev(instant: Date | string, timeZone: string): string {
  return formatInTimeZone(toDate(instant), timeZone, "zzz");
}

/** 12h time with AM/PM in both languages (§5.2): "2:00 PM". */
export function fmtTime(instant: Date | string, timeZone: string): string {
  return formatInTimeZone(toDate(instant), timeZone, "h:mm a");
}

/** Time with real zone abbreviation: "2:00 PM EDT". */
export function fmtTimeZoned(instant: Date | string, timeZone: string): string {
  return formatInTimeZone(toDate(instant), timeZone, "h:mm a zzz");
}

/** Desktop full date: "jueves, 12 de junio de 2026". */
export function fmtDateFull(
  instant: Date | string,
  timeZone: string,
  locale: Locale,
): string {
  const zoned = toZonedTime(toDate(instant), timeZone);
  return format(zoned, "PPPP", { locale: dfLocale(locale) });
}

/** Header date for "Mi día": "Miércoles, 3 de junio" (capitalized weekday). */
export function fmtHeaderDate(
  instant: Date | string,
  timeZone: string,
  locale: Locale,
): string {
  const zoned = toZonedTime(toDate(instant), timeZone);
  const s = format(zoned, locale === "en" ? "EEEE, MMMM d" : "EEEE, d 'de' MMMM", {
    locale: dfLocale(locale),
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Short date: "12 jun" / "Jun 12". */
export function fmtDateShort(
  instant: Date | string,
  timeZone: string,
  locale: Locale,
): string {
  const zoned = toZonedTime(toDate(instant), timeZone);
  return format(zoned, locale === "en" ? "MMM d" : "d MMM", {
    locale: dfLocale(locale),
  });
}

/** Relative time: "hace 6 min" / "6 min ago". */
export function fmtRelative(instant: Date | string, locale: Locale): string {
  return formatDistanceToNow(toDate(instant), {
    addSuffix: true,
    locale: dfLocale(locale),
  });
}

/**
 * Dual-hour string for the staff panel (§6.5): the staff hour as primary and,
 * when the client TZ differs, the client hour as a secondary clause.
 *
 *   "12:00 PM MT · 2:00 PM ET (cliente)"  (staff in Utah, client in Florida)
 *
 * Both derived from the same UTC instant. Returns `{ primary, secondary }`;
 * `secondary` is null when the two zones resolve to the same wall time.
 */
export function dualHour(
  instant: Date | string,
  staffTz: string,
  clientTz: string | null,
  locale: Locale,
): { primary: string; secondary: string | null } {
  const d = toDate(instant);
  const primary = fmtTimeZoned(d, staffTz);
  if (!clientTz || clientTz === staffTz) return { primary, secondary: null };
  const clientHour = fmtTimeZoned(d, clientTz);
  if (clientHour === primary) return { primary, secondary: null };
  const tag = locale === "en" ? "(client)" : "(cliente)";
  return { primary, secondary: `${clientHour} ${tag}` };
}

/**
 * Dual-hour string for the CLIENT app (§6.5): the client's own time as primary
 * and, when the staff TZ differs, the staff hour as a small secondary clause that
 * names the staff city (the prototype uses Utah → "12:00 PM en Utah").
 *
 *   client in Florida, staff in Utah, 18:00Z →
 *     { primary: "2:00 PM", secondary: "12:00 PM en Utah" }
 *
 * Both derived from the same UTC instant — the offset is NEVER a fixed table
 * (DOC-23 §6.4). `secondary` is null when the two zones resolve to the same wall
 * time. `staffCity` defaults to the city segment of the IANA staff TZ.
 */
export function clientDualHour(
  instant: Date | string,
  clientTz: string,
  staffTz: string | null,
  locale: Locale,
  staffCity?: string,
): { primary: string; secondary: string | null } {
  const d = toDate(instant);
  const primary = fmtTime(d, clientTz);
  if (!staffTz || staffTz === clientTz) return { primary, secondary: null };
  const staffHour = fmtTime(d, staffTz);
  if (staffHour === primary) return { primary, secondary: null };
  const city = staffCity ?? cityFromTz(staffTz);
  const inWord = locale === "en" ? "in" : "en";
  return { primary, secondary: `${staffHour} ${inWord} ${city}` };
}

/** Human city name from an IANA zone ("America/Denver" → "Utah" for the office). */
function cityFromTz(timeZone: string): string {
  // The office lives in Utah (America/Denver). Keep the friendly business name
  // the prototype uses; otherwise fall back to the IANA city segment.
  if (timeZone === "America/Denver") return "Utah";
  return timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
}

function toDate(instant: Date | string): Date {
  return instant instanceof Date ? instant : new Date(instant);
}
