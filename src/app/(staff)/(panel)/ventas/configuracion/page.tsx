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

export const dynamic = "force-dynamic";

export default async function VentasConfigPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.ventas.config");

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
  };

  return (
    <LexPrefsProvider>
      <ConfiguracionView strings={strings} locale={locale} actions={{ setLocale: setUserLocaleAction }} />
    </LexPrefsProvider>
  );
}
