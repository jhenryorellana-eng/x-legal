"use client";

/**
 * US ZIP → city/state autofill hook (RF-VAN-018 — "Nuevo caso" step 1).
 *
 * Ported from UsaLatinoPrime v1 (QuickContractGenerator): 350ms debounce after
 * the last keystroke, AbortController cancellation, and an
 * idle/loading/found/not-found state machine. Talks to our own thin proxy
 * (`GET /api/v1/zip-lookup`) — never to zippopotam.us from the browser (CSP
 * `connect-src 'self'`, DOC-27 §6).
 *
 * Reusable by any staff/client address form. Resolved ZIPs are cached in
 * memory for the session, so re-typing a known ZIP fills instantly with no
 * network round-trip.
 */

import * as React from "react";

export type ZipLookupStatus = "idle" | "loading" | "found" | "not-found";

export interface UsZipPlace {
  city: string;
  state: string;
}

/**
 * Extracts the 5-digit base from a ZIP or ZIP+4 (`33101`, `33101-1234`).
 * Returns null for anything else (partial input, non-digits).
 */
export function extractZip5(zip: string): string | null {
  const match = zip.trim().match(/^(\d{5})(?:-\d{4})?$/);
  return match ? match[1] : null;
}

/** Session cache — a ZIP's city/state never changes within a session. */
const resolvedZips = new Map<string, UsZipPlace>();

const DEBOUNCE_MS = 350;

/**
 * Watches a ZIP field and calls `onResolved` with the city/state once a valid
 * 5-digit ZIP is entered. Purely additive: the target fields stay editable and
 * a "not-found" never blocks the form (manual entry fallback).
 *
 * @param zip      Current value of the ZIP input (ZIP+4 allowed — base is used).
 * @param enabled  Gate the lookup (e.g. only after the user actually edited the
 *                 ZIP, so programmatic prefills neither fire requests nor
 *                 clobber a stored address). `false` → status "idle".
 * @param onResolved Called with { city, state } on success (also from cache).
 */
export function useUsZipLookup(
  zip: string,
  enabled: boolean,
  onResolved: (place: UsZipPlace) => void,
): ZipLookupStatus {
  const [status, setStatus] = React.useState<ZipLookupStatus>("idle");
  // Pin the callback: the effect must depend on the ZIP, not on the parent's
  // inline closure identity.
  const onResolvedRef = React.useRef(onResolved);
  onResolvedRef.current = onResolved;

  React.useEffect(() => {
    const zip5 = enabled ? extractZip5(zip) : null;
    if (!zip5) {
      setStatus("idle");
      return;
    }
    const cached = resolvedZips.get(zip5);
    if (cached) {
      onResolvedRef.current(cached);
      setStatus("found");
      return;
    }
    setStatus("loading");
    const ctrl = new AbortController();
    const tid = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/zip-lookup?zip=${zip5}`, { signal: ctrl.signal });
        if (!res.ok) {
          setStatus("not-found");
          return;
        }
        const data = (await res.json()) as Partial<UsZipPlace>;
        if (!data?.city || !data?.state) {
          setStatus("not-found");
          return;
        }
        const place = { city: String(data.city), state: String(data.state) };
        resolvedZips.set(zip5, place);
        onResolvedRef.current(place);
        setStatus("found");
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") setStatus("not-found");
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(tid);
      ctrl.abort();
    };
  }, [zip, enabled]);

  return status;
}
