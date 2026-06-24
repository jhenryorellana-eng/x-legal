/**
 * Geolocation helpers (DOC-23 §6.5) — turn the device's coordinates into a
 * timezone + city/country, used by the "Detect my location" button in
 * Configuración. The browser geolocation API itself is accessed through the
 * platform bridge (RNF-036); this module only does pure computation + a fetch
 * to a public reverse-geocoder, both allowed inside features.
 */

export interface ResolvedLocation {
  /** IANA timezone, from the browser (Intl) — independent of the geocoder. */
  timezone: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
}

/** The device's IANA timezone via Intl (no permission needed). Null if unavailable. */
export function detectBrowserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Reverse-geocodes coordinates to city/country via BigDataCloud's free
 * client-side endpoint (no API key). Best-effort: returns nulls on any failure.
 * The coordinates are sent to BigDataCloud only to resolve the place name.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
  locale: "es" | "en" = "es",
): Promise<{ city: string | null; country: string | null; countryCode: string | null }> {
  const empty = { city: null, country: null, countryCode: null };
  try {
    const url =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${encodeURIComponent(latitude)}` +
      `&longitude=${encodeURIComponent(longitude)}` +
      `&localityLanguage=${encodeURIComponent(locale)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return empty;
    const j = (await res.json()) as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
      countryName?: string;
      countryCode?: string;
    };
    return {
      city: j.city || j.locality || j.principalSubdivision || null,
      country: j.countryName || null,
      countryCode: j.countryCode || null,
    };
  } catch {
    return empty;
  }
}
