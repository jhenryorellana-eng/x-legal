/**
 * Configuración — finance panel account prefs · /finanzas/configuracion
 * (DOC-24 i18n). Minimal per-role settings page exposing the ES/EN language
 * switch (persists users.locale). Reachable by finance + admin (nav gated by the
 * `accounting` module).
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { setUserLocaleAction } from "@/backend/modules/identity/actions";
import { StaffLanguageCard } from "@/frontend/components/desktop/staff-language-card";
import { StaffAppearanceCard } from "@/frontend/components/desktop/staff-appearance-card";

export const dynamic = "force-dynamic";

export default async function FinanzasConfigPage() {
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
      </div>
    </div>
  );
}
