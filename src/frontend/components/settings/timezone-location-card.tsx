"use client";

import * as React from "react";
import { getBridge } from "@/frontend/platform-bridge";
import { reverseGeocode, detectBrowserTimezone } from "@/frontend/lib/geocoding";
import { timezoneOptions } from "@/frontend/lib/timezones";

type ActionResult = { ok: boolean };

export interface TimezoneLocationLabels {
  /** Section / card heading, e.g. "Zona horaria". */
  title: string;
  /** One-line helper under the heading. */
  subtitle: string;
  /** "Detectar mi ubicación" */
  detect: string;
  /** Shown while detecting. */
  detecting: string;
  /** Prefix for the current city/country line, e.g. "Ubicación". */
  locationLabel: string;
  /** Shown when geolocation is unavailable/denied. */
  detectUnavailable: string;
}

export interface TimezoneLocationCardProps {
  initialTimezone: string;
  initialCity: string | null;
  initialCountry: string | null;
  locale: "es" | "en";
  labels: TimezoneLocationLabels;
  /** Persists timezone only (manual select) → users.timezone + ulp-tz cookie. */
  setTimezone: (tz: string) => Promise<ActionResult>;
  /** Persists detected timezone + city/country → users + ulp-tz cookie. */
  setLocation: (input: {
    timezone: string;
    city: string | null;
    country: string | null;
    countryCode: string | null;
  }) => Promise<ActionResult>;
  /** Optional style overrides for the outer container. */
  style?: React.CSSProperties;
}

/**
 * Timezone + location card shared by the client `/config` and every staff
 * `configuración` (DOC-23 §6.5). Manual zone selection persists immediately;
 * "Detect my location" uses the platform bridge geolocation (RNF-036) + a
 * client-side reverse geocode to fill city/country and the browser timezone.
 * Both paths reload so SSR re-renders appointment times in the new zone.
 */
export function TimezoneLocationCard({
  initialTimezone,
  initialCity,
  initialCountry,
  locale,
  labels,
  setTimezone,
  setLocation,
  style,
}: TimezoneLocationCardProps) {
  const [tz, setTz] = React.useState(initialTimezone);
  const [city, setCity] = React.useState(initialCity);
  const [country, setCountry] = React.useState(initialCountry);
  const [busy, setBusy] = React.useState(false);
  const [unavailable, setUnavailable] = React.useState(false);
  const options = timezoneOptions(tz);

  async function onSelect(next: string) {
    if (!next || next === tz || busy) return;
    const prev = tz;
    setBusy(true);
    setTz(next);
    const res = await setTimezone(next);
    if (res.ok) window.location.reload();
    else {
      setTz(prev);
      setBusy(false);
    }
  }

  async function onDetect() {
    if (busy) return;
    setBusy(true);
    setUnavailable(false);
    try {
      const coords = await getBridge().geolocation.getCurrentPosition();
      const browserTz = detectBrowserTimezone();
      if (!coords && !browserTz) {
        setUnavailable(true);
        setBusy(false);
        return;
      }
      const geo = coords
        ? await reverseGeocode(coords.latitude, coords.longitude, locale)
        : { city: null, country: null, countryCode: null };
      // Timezone: browser Intl is authoritative for the IANA zone; fall back to
      // the current one if unavailable.
      const timezone = browserTz ?? tz;
      const res = await setLocation({
        timezone,
        city: geo.city,
        country: geo.country,
        countryCode: geo.countryCode,
      });
      if (res.ok) {
        // Optimistic UI before the reload picks up the SSR values.
        setTz(timezone);
        setCity(geo.city);
        setCountry(geo.country);
        window.location.reload();
      } else {
        setBusy(false);
      }
    } catch {
      setUnavailable(true);
      setBusy(false);
    }
  }

  const locationText = [city, country].filter(Boolean).join(", ");

  return (
    <div
      style={{
        background: "var(--card)",
        borderRadius: 16,
        border: "1px solid var(--line)",
        padding: 16,
        ...style,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--navy)", marginBottom: 4 }}>
        {labels.title}
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 12 }}>
        {labels.subtitle}
      </div>

      <select
        value={tz}
        disabled={busy}
        onChange={(e) => void onSelect(e.target.value)}
        aria-label={labels.title}
        style={{
          width: "100%",
          height: 46,
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "var(--bg, #fff)",
          color: "var(--navy)",
          fontWeight: 600,
          fontSize: 15,
          padding: "0 12px",
          cursor: busy ? "default" : "pointer",
        }}
      >
        {options.map((z) => (
          <option key={z.id} value={z.id}>
            {locale === "en" ? z.en : z.es}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => void onDetect()}
        disabled={busy}
        style={{
          marginTop: 10,
          width: "100%",
          height: 42,
          borderRadius: 12,
          border: "1px solid var(--accent)",
          background: "transparent",
          color: "var(--accent)",
          fontWeight: 700,
          fontSize: 14,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? labels.detecting : labels.detect}
      </button>

      {locationText && (
        <div style={{ marginTop: 10, fontSize: 13, color: "var(--ink-2)" }}>
          {labels.locationLabel}: <strong style={{ color: "var(--navy)" }}>{locationText}</strong>
        </div>
      )}
      {unavailable && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-3, #888)" }}>
          {labels.detectUnavailable}
        </div>
      )}
    </div>
  );
}
