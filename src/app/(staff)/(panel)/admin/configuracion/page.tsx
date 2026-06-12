/**
 * Organization settings — /admin/configuracion (DOC-53 §9, P-53-1).
 *
 * Server Component: guards the actor, reads the org config + cover templates +
 * terms overview via the org module-pub reads, and passes them + the server
 * actions to the client config view. General (org settings), Carátulas (cover
 * templates) and T&C (versions + compliance) are all implementable in F1 — the
 * tables exist in the schema (P-1 of DOC-14 is resolved).
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getOrgConfig, listCoverTemplates, getTermsOverview } from "@/backend/modules/org";
import { resolveI18n, type Locale } from "@/shared/i18n";
import { ConfigView } from "@/frontend/features/admin/config/config-view";
import { saveOrgSettings, setCoverActive, createTerms, publishTerms } from "./actions";

/** Common US/Latam IANA timezones (the form offers a curated list). */
const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Caracas",
];

export default async function ConfigPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.admin");
  const tt = t as unknown as (key: string) => string;

  const [org, covers, termsOverview] = await Promise.all([
    getOrgConfig(actor),
    listCoverTemplates(actor),
    getTermsOverview(actor),
  ]);

  const terms = termsOverview.versions.map((v) => ({
    id: v.id,
    version: v.version,
    title: resolveI18n(v.title_i18n, locale),
    is_active: v.is_active,
    published_at: v.published_at,
  }));

  return (
    <ConfigView
      org={{ id: org.id, name: org.name, settings: org.settings }}
      covers={covers.map((c) => ({ id: c.id, name: c.name, is_active: c.is_active }))}
      terms={terms}
      acceptances={termsOverview.acceptances}
      timezones={TIMEZONES}
      messages={buildConfigStrings(tt)}
      actions={{ saveOrg: saveOrgSettings, setCoverActive, createTerms, publishTerms }}
    />
  );
}

function buildConfigStrings(tt: (k: string) => string): Record<string, string> {
  const keys = [
    "title", "sub", "tabGeneral", "tabCovers", "tabTerms", "orgName", "logo",
    "contactPhones", "phoneLabel", "phoneNumber", "addPhone", "timezone",
    "invalidPhone", "generalNote", "coversEmptyTitle", "coversEmptySub",
    "coverActive", "coverInactive", "coverInactiveNote", "coverEditNote",
    "termsCurrent", "termsCurrentChip", "termsHistory", "termsNewVersion",
    "termsVersionId", "termsTitle", "termsBody", "termsPublish", "termsPublished",
    "termsCompliance", "termsAcceptedBy", "termsImmutable", "termsEmptyTitle",
    "termsEmptySub",
  ];
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = tt(`config.${k}`);
  out.save = tt("common.save");
  out.cancel = tt("common.cancel");
  out.delete = tt("common.delete");
  out.saved = tt("common.saved");
  return out;
}
