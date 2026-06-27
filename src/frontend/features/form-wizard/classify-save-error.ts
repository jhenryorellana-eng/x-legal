/**
 * Autosave error policy — the single source of truth for "should we retry?".
 *
 * The draft-save Server Action (API-CASE-16) can fail two fundamentally different
 * ways:
 *  - TRANSIENT: a network hiccup, an unexpected server error, or a creation race.
 *    Retrying (after backoff / on reconnect) can succeed.
 *  - PERMANENT: the form was submitted on another device, the client is on a stale
 *    version, or a value is the wrong type. Retrying the same patch can NEVER
 *    succeed — it just pins the user in "error" and hammers the server.
 *
 * Consumed by BOTH the client engine (autosave-controller) and the Server Action
 * (`actions.ts`, which returns the verdict as `retryable`) so the policy lives in
 * exactly one place. A code that isn't explicitly transient defaults to PERMANENT:
 * that can never cause an infinite retry loop, and the engine keeps the unconfirmed
 * answers in IndexedDB regardless, so a mis-classification never loses data.
 */

export type SaveErrorClass = "transient" | "permanent";

/**
 * Error codes (from `CaseError` / the action wrapper) that a retry might resolve.
 * Everything else is treated as permanent.
 *  - UNEXPECTED: non-CaseError thrown server-side (incl. AuthzError) — bounded retry.
 *  - FORM_RESPONSE_NOT_FOUND: the draft row vanished between merge and read-back
 *    (a creation/delete race) — recreating it on retry can succeed.
 */
export const TRANSIENT_SAVE_CODES: ReadonlySet<string> = new Set([
  "UNEXPECTED",
  "FORM_RESPONSE_NOT_FOUND",
]);

export function classifySaveError(code: string | undefined): SaveErrorClass {
  return code !== undefined && TRANSIENT_SAVE_CODES.has(code) ? "transient" : "permanent";
}
