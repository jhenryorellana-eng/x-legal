/**
 * US ZIP → city/state lookup (service layer of the identity module).
 *
 * Server-side proxy to the public zippopotam.us API (no key, US-only — the
 * product is US-only by design: the address prefills the I-589). Called by the
 * thin route handler `GET /api/v1/zip-lookup`; the browser never talks to the
 * upstream API directly (CSP `connect-src 'self'`, DOC-27 §6).
 *
 * Ported from UsaLatinoPrime v1 (`api/admin/zip-lookup`), hardened: zod-validated
 * upstream payload and a discriminated-union result instead of bare HTTP codes.
 *
 * Lives in its own file (not domain.ts) because it performs IO (rule R4).
 */

import { z } from "zod";

/** Canonical US ZIP: exactly 5 digits (ZIP+4 is stripped by the caller). */
export const US_ZIP_REGEX = /^\d{5}$/;

const ZippopotamResponseSchema = z.object({
  places: z
    .array(
      z.object({
        "place name": z.string(),
        "state abbreviation": z.string(),
      }),
    )
    .min(1),
});

export type UsZipLookupResult =
  | { status: "found"; city: string; state: string }
  | { status: "not_found" }
  | { status: "failed" };

/** Upstream call budget — the API is fast; 5s is generous (same as v1). */
const UPSTREAM_TIMEOUT_MS = 5000;

/**
 * Resolves a 5-digit US ZIP to its city + state abbreviation.
 *
 * Multi-city ZIPs resolve to the first place (zippopotam ordering) — the staff
 * can always correct the city manually; the lookup never blocks a submission.
 *
 * @returns "found" with city/state · "not_found" for unknown ZIPs · "failed"
 *          when the upstream API errors or times out (caller maps to 502).
 */
export async function lookupUsZip(zip: string): Promise<UsZipLookupResult> {
  if (!US_ZIP_REGEX.test(zip)) return { status: "not_found" };
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) return { status: "failed" };
    const parsed = ZippopotamResponseSchema.safeParse(await res.json());
    if (!parsed.success) return { status: "not_found" };
    const place = parsed.data.places[0];
    return {
      status: "found",
      city: place["place name"],
      state: place["state abbreviation"],
    };
  } catch {
    return { status: "failed" };
  }
}
