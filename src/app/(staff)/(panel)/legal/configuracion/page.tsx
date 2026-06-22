/**
 * Configuración — legal panel account prefs · /legal/configuracion
 * (DOC-24 i18n). Minimal per-role settings page exposing the ES/EN language
 * switch (persists users.locale). Reachable by paralegal + admin (nav gated by
 * the `validations` module).
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { setUserLocaleAction } from "@/backend/modules/identity/actions";
import {
  registerPushSubscriptionAction,
  removePushSubscriptionAction,
} from "@/backend/modules/notifications/actions";
import { StaffLanguageCard } from "@/frontend/components/desktop/staff-language-card";
import { StaffAppearanceCard } from "@/frontend/components/desktop/staff-appearance-card";
import { StaffPushCard } from "@/frontend/components/desktop/staff-push-card";

export const dynamic = "force-dynamic";

export default async function LegalConfigPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) === "en" ? "en" : "es";
  const t = await getTranslations("staff.config");

  return (
    <div style={{ maxWidth: 760 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: "var(--font-title)", fontWeight: 900, fontSize: 26, color: "var(--ink)", margin: 0, letterSpacing: "-0.02em" }}>
          {t("title")}
        </h1>
        <div style={{ fontSize: 14, color: "var(--ink-2)", fontWeight: 600, marginTop: 4 }}>{t("sub")}</div>
      </header>
      <div style={{ display: "grid", gap: 16 }}>
        <StaffAppearanceCard strings={{ title: t("appearance"), subtitle: t("appearanceSub") }} />
        <StaffLanguageCard
          current={locale}
          setLocale={setUserLocaleAction}
          strings={{ title: t("language"), subtitle: t("languageSub"), spanish: t("spanish"), english: t("english") }}
        />
        <StaffPushCard
          vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}
          registerAction={registerPushSubscriptionAction}
          removeAction={removePushSubscriptionAction}
          strings={{
            title: t("pushTitle"),
            subtitle: t("pushSub"),
            enable: t("pushEnable"),
            disable: t("pushDisable"),
            enabled: t("pushEnabled"),
            unsupported: t("pushUnsupported"),
            denied: t("pushDenied"),
          }}
        />
      </div>
    </div>
  );
}
