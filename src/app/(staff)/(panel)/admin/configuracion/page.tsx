/**
 * Organization settings — /admin/configuracion (DOC-53 §9, P-53-1).
 *
 * Server Component: guards the actor, reads the org config + cover templates +
 * terms overview via the org module-pub reads, and passes them + the server
 * actions to the client config view. General (org settings), Carátulas (cover
 * templates) and T&C (versions + compliance) are all implementable in F1 — the
 * tables exist in the schema (P-1 of DOC-14 is resolved).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { setUserLocaleAction } from "@/backend/modules/identity/actions";
import {
  registerPushSubscriptionAction,
  removePushSubscriptionAction,
} from "@/backend/modules/notifications/actions";
import { getOrgConfig, listCoverTemplates, getTermsOverview } from "@/backend/modules/org";
import { resolveI18n, type Locale } from "@/shared/i18n";
import { ConfigView } from "@/frontend/features/admin/config/config-view";
import { StaffLanguageCard } from "@/frontend/components/desktop/staff-language-card";
import { StaffAppearanceCard } from "@/frontend/components/desktop/staff-appearance-card";
import { StaffPushCard } from "@/frontend/components/desktop/staff-push-card";
import { StaffTimezoneSection } from "../../_components/staff-timezone-section";
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
  const tCfg = await getTranslations("staff.config");
  const tTabs = await getTranslations("staff.caseTabs");
  const tt = t as unknown as (key: string) => string;
  const tRaw = t.raw as unknown as (key: string) => string;

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
    <>
      <ConfigView
        org={{ id: org.id, name: org.name, settings: org.settings }}
        covers={covers.map((c) => ({ id: c.id, name: c.name, is_active: c.is_active }))}
        terms={terms}
        acceptances={termsOverview.acceptances}
        timezones={TIMEZONES}
        messages={buildConfigStrings(tt, tRaw)}
        actions={{ saveOrg: saveOrgSettings, setCoverActive, createTerms, publishTerms }}
      />
      <div style={{ marginTop: 20, display: "grid", gap: 16, maxWidth: 760 }}>
        <Link
          href="/admin/configuracion/tabs-caso"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 18px",
            border: "1px solid var(--line)",
            borderRadius: 14,
            background: "var(--card, #fff)",
            textDecoration: "none",
          }}
        >
          <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{tTabs("title")}</span>
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{tTabs("sub")}</span>
          </span>
          <span style={{ fontSize: 20, color: "var(--ink-3)" }}>›</span>
        </Link>
        <StaffAppearanceCard
          strings={{ title: tCfg("appearance"), subtitle: tCfg("appearanceSub") }}
        />
        <StaffLanguageCard
          current={locale === "en" ? "en" : "es"}
          setLocale={setUserLocaleAction}
          strings={{
            title: tCfg("language"),
            subtitle: tCfg("languageSub"),
            spanish: tCfg("spanish"),
            english: tCfg("english"),
          }}
        />
        <StaffPushCard
          vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}
          registerAction={registerPushSubscriptionAction}
          removeAction={removePushSubscriptionAction}
          strings={{
            title: tCfg("pushTitle"),
            subtitle: tCfg("pushSub"),
            enable: tCfg("pushEnable"),
            disable: tCfg("pushDisable"),
            enabled: tCfg("pushEnabled"),
            unsupported: tCfg("pushUnsupported"),
            denied: tCfg("pushDenied"),
          }}
        />
        <StaffTimezoneSection locale={locale === "en" ? "en" : "es"} />
      </div>
    </>
  );
}

function buildConfigStrings(
  tt: (k: string) => string,
  raw: (k: string) => string,
): Record<string, string> {
  const keys = [
    "title", "sub", "tabGeneral", "tabCovers", "tabTerms", "orgName", "logo",
    "contactPhones", "phoneLabel", "phoneNumber", "addPhone", "timezone",
    "representativeName", "representativePlaceholder", "paymentZelle", "paymentZellePlaceholder",
    "invalidPhone", "generalNote", "coversEmptyTitle", "coversEmptySub",
    "coverActive", "coverInactive", "coverInactiveNote", "coverEditNote",
    "termsCurrent", "termsCurrentChip", "termsHistory", "termsNewVersion",
    "termsVersionId", "termsTitle", "termsBody", "termsPublish", "termsPublished",
    "termsCompliance", "termsAcceptedBy", "termsImmutable", "termsEmptyTitle",
    "termsEmptySub",
  ];
  // These carry ICU placeholders ({date}/{n}) substituted downstream by ConfigView;
  // t() would throw FORMATTING_ERROR (values not provided here) — use raw templates.
  const RAW_KEYS = new Set(["termsPublished", "termsAcceptedBy"]);
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = RAW_KEYS.has(k) ? raw(`config.${k}`) : tt(`config.${k}`);
  out.save = tt("common.save");
  out.cancel = tt("common.cancel");
  out.delete = tt("common.delete");
  out.saved = tt("common.saved");
  return out;
}
