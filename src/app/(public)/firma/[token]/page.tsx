/**
 * Public contract-signing page — /firma/[token] (DOC-51 §27, DOC-22 §4).
 *
 * Anonymous bearer surface (no session). Server Component:
 * - Looks up the contract by token via the SERVICE client (rate limited by IP).
 * - A token that is invalid / expired / consumed yields a UNIFORM "link
 *   unavailable" screen at HTTP 200 (anti-enumeration: the firmante legítimo and
 *   an attacker see the same thing; we never `notFound()` to avoid revealing a
 *   distinguishable status). CERO datos del contrato in that branch.
 * - Locale is derived from Accept-Language (there is no users.locale here).
 *
 * Mobile-first (the client signs from their phone). Mobile tokens: the surface
 * uses the default [data-theme] (NO .surface-staff).
 */

import { headers } from "next/headers";
import {
  getContractBySigningToken,
  ContractError,
} from "@/backend/modules/contracts";
import { SigningView } from "./signing-view";
import { LinkUnavailable } from "./link-unavailable";
import {
  buildSigningStrings,
  localeFromAcceptLanguage,
} from "./strings";
import { asPlanSnapshot, asPartiesSnapshot, readI18nLoose } from "./snapshot";
import { signContractAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FirmaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const headerStore = await headers();
  const ip =
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerStore.get("x-real-ip") ??
    "unknown";
  const locale = localeFromAcceptLanguage(headerStore.get("accept-language"));
  const strings = buildSigningStrings(locale);

  let view: Awaited<ReturnType<typeof getContractBySigningToken>> | null = null;
  try {
    view = await getContractBySigningToken(token, ip);
  } catch (err) {
    // Uniform: any failure (not found / expired / consumed / rate limit) →
    // the same unavailable screen. No data, no distinguishable status.
    if (!(err instanceof ContractError)) {
      // Rate-limit or unexpected → still show the uniform screen (200).
    }
    return <LinkUnavailable strings={strings} locale={locale} />;
  }

  const plan = asPlanSnapshot(view.planSnapshot);
  const parties = asPartiesSnapshot(view.partiesSnapshot);

  // T&C body: the active terms_versions for the org is referenced by
  // contracts.terms_version. The public read returns only the version string;
  // the full body lives in terms_versions (org-scoped, no anon RLS). For F2-W2-b
  // we render the contract structure (service, plan, parties, payment plan) +
  // the canonical 5-section notice text. TODO(F-terms): join the active
  // terms_versions body when a public-safe read exists.
  const serviceLabel = readI18nLoose(plan.serviceLabel, locale);

  return (
    <SigningView
      token={token}
      locale={locale}
      strings={strings}
      serviceLabel={serviceLabel}
      planKind={plan.planKind ?? "self"}
      totalCents={plan.totalCents ?? 0}
      currency={plan.currency ?? "USD"}
      installments={plan.installments ?? []}
      parties={(parties.parties ?? []).map((p) => ({
        name: p.name,
        role: readI18nLoose(p.role, locale),
      }))}
      termsVersion={view.termsVersion}
      signAction={signContractAction}
    />
  );
}
