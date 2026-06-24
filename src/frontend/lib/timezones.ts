/**
 * Curated IANA timezone choices for the Configuración picker (DOC-23 §6.5).
 * Common US zones the clientele/staff live in + a few LatAm zones. The user can
 * also auto-detect via browser geolocation, which may yield a zone outside this
 * list — callers should prepend the current zone when it isn't present.
 */
export interface TimezoneOption {
  id: string;
  es: string;
  en: string;
}

export const TIMEZONES: TimezoneOption[] = [
  { id: "America/New_York", es: "Florida / Este (ET)", en: "Florida / Eastern (ET)" },
  { id: "America/Chicago", es: "Centro (CT)", en: "Central (CT)" },
  { id: "America/Denver", es: "Montaña (MT)", en: "Mountain (MT)" },
  { id: "America/Phoenix", es: "Arizona (MST)", en: "Arizona (MST)" },
  { id: "America/Los_Angeles", es: "Pacífico (PT)", en: "Pacific (PT)" },
  { id: "America/Bogota", es: "Colombia / Perú (COT)", en: "Colombia / Peru (COT)" },
  { id: "America/Mexico_City", es: "Ciudad de México", en: "Mexico City" },
  { id: "America/Guatemala", es: "Centroamérica", en: "Central America" },
  { id: "America/Santo_Domingo", es: "Rep. Dominicana", en: "Dominican Republic" },
];

/** Returns the option list, prepending the current zone if it isn't curated. */
export function timezoneOptions(current: string): TimezoneOption[] {
  if (TIMEZONES.some((z) => z.id === current)) return TIMEZONES;
  return [{ id: current, es: current, en: current }, ...TIMEZONES];
}

/** Localized label for a timezone id (falls back to the raw id). */
export function timezoneLabel(id: string, locale: "es" | "en"): string {
  const opt = TIMEZONES.find((z) => z.id === id);
  return opt ? opt[locale] : id;
}
