/**
 * Configuración — finance panel account prefs · /finanzas/configuracion
 * (DOC-24 i18n). Minimal per-role settings page exposing the ES/EN language
 * switch (persists users.locale). Reachable by finance + admin (nav gated by the
 * `accounting` module).
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor, can } from "@/backend/modules/identity";
import { setUserLocaleAction } from "@/backend/modules/identity/actions";
import {
  registerPushSubscriptionAction,
  removePushSubscriptionAction,
} from "@/backend/modules/notifications/actions";
import { getReconConfig } from "@/backend/modules/zelle-recon";
import { StaffLanguageCard } from "@/frontend/components/desktop/staff-language-card";
import { StaffAppearanceCard } from "@/frontend/components/desktop/staff-appearance-card";
import { StaffPushCard } from "@/frontend/components/desktop/staff-push-card";
import { StaffTimezoneSection } from "../../_components/staff-timezone-section";
import {
  ZelleReconConfigCard,
  type ZelleReconConfigVM,
} from "@/frontend/features/andrium/configuracion/zelle-recon-config-card";
import { updateZelleReconConfigAction } from "../pagos/actions";

export const dynamic = "force-dynamic";

export default async function FinanzasConfigPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) === "en" ? "en" : "es";
  const t = await getTranslations("staff.config");

  // Zelle reconciliation breakers — finance/admin with billing:edit only.
  // Degrades to null before migration 0111 is applied (tables absent).
  let reconConfig: ZelleReconConfigVM | null = null;
  try {
    can(actor, "billing", "edit");
    const cfg = await getReconConfig(actor.orgId);
    reconConfig = {
      enabled: cfg.enabled,
      tier_a_max_amount_cents: cfg.tierAMaxAmountCents,
      daily_auto_max_cents: cfg.dailyAutoMaxCents,
      daily_auto_max_count: cfg.dailyAutoMaxCount,
      per_payer_daily_max: cfg.perPayerDailyMax,
      tier_b_mode: cfg.tierBMode,
    };
  } catch {
    reconConfig = null;
  }

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
        {reconConfig ? (
          <ZelleReconConfigCard
            config={reconConfig}
            locale={locale}
            updateAction={updateZelleReconConfigAction}
          />
        ) : null}
      </div>
      <StaffTimezoneSection locale={locale} />
    </div>
  );
}
