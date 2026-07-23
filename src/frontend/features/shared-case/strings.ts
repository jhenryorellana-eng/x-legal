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

/**
 * Maps a server-action error `code` to a human-readable, localized message.
 *
 * Server actions (admin/casos/actions.ts `mapErr`) return only a stable `code`,
 * never a user-facing message. Without this the UI fell back to the generic
 * "No pudimos cargar los casos." for EVERY failure — including permission
 * denials while creating a case — which told the operator nothing about the
 * real cause. Codes come from AuthzError.reason (forbidden_module, …) and the
 * domain error codes thrown by the create-case flow. Unknown codes degrade to a
 * neutral generic message (not the misleading "load cases" string).
 */
export function resolveCasosActionError(
  code: string | undefined,
  strings: CasosStrings,
): string {
  const e = strings.actionError;
  switch (code) {
    case "forbidden_module":
    case "forbidden_case":
    case "wrong_kind":
    case "cross_org_access_denied":
      return e.permission;
    case "unauthenticated":
    case "inactive":
      return e.session;
    case "INVALID_ADDRESS":
      return e.address;
    case "INVALID_EMAIL":
      return e.email;
    case "INVALID_PHONE":
      return e.phone;
    case "INVALID_PLAN":
      return e.plan;
    case "CONTRACT_TOKEN_INVALID":
      return e.signingLink;
    case "INVALID_QUALIFICATION":
      return e.qualification;
    default:
      return e.generic;
  }
}
