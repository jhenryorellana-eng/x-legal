/**
 * Configuración — sales account & panel prefs · /ventas/configuracion
 * (DOC-52 §8, RF-VAN-055).
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { ConfiguracionView, LexPrefsProvider } from "@/frontend/features/vanessa";
import type { Locale } from "@/frontend/lib/datetime";
import { setUserLocaleAction } from "@/backend/modules/identity/actions";
import {
  registerPushSubscriptionAction,
  removePushSubscriptionAction,
} from "@/backend/modules/notifications/actions";

export const dynamic = "force-dynamic";

export default async function VentasConfigPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.ventas.config");
  const tCfg = await getTranslations("staff.config");

  const strings = {
    title: t("title"),
    sub: t("sub"),
    name: t("name"),
    role: t("role"),
    email: t("email"),
    tzChip: t("tzChip"),
    edit: t("edit"),
    appearance: t("appearance"),
    darkMode: t("darkMode"),
    darkModeSub: t("darkModeSub"),
    textSize: t("textSize"),
    accent: t("accent"),
    lexTitle: t("lexTitle"),
    lexBubbles: t("lexBubbles"),
    lexBubblesSub: t("lexBubblesSub"),
    language: t("language"),
    spanish: t("spanish"),
    english: t("english"),
    saved: t("saved"),
    pushTitle: tCfg("pushTitle"),
    pushSub: tCfg("pushSub"),
    pushEnabled: tCfg("pushEnabled"),
    pushUnsupported: tCfg("pushUnsupported"),
    pushDenied: tCfg("pushDenied"),
  };

  return (
    <LexPrefsProvider>
      <ConfiguracionView
        strings={strings}
        locale={locale}
        actions={{ setLocale: setUserLocaleAction }}
        push={{
          vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
          registerAction: registerPushSubscriptionAction,
          removeAction: removePushSubscriptionAction,
        }}
      />
    </LexPrefsProvider>
  );
}
