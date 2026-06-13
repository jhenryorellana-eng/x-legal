/**
 * Configuración — `/config` · nivel CUENTA (DOC-51 §11).
 *
 * Server component. Resolves the current locale and injects `signOutAction`
 * (DOC-50 §2) into the client ConfigScreen, which owns theme / text-scale /
 * language toggles (local + cookie, no flash).
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { signOutAction } from "@/backend/modules/identity/actions";
import { ConfigScreen } from "@/frontend/features/cliente/config/config-screen";

export default async function ConfigPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as "es" | "en";
  const t = await getTranslations("cliente.config");

  async function onSignOut() {
    "use server";
    await signOutAction();
    redirect("/welcome");
  }

  return (
    <ConfigScreen
      initialLocale={locale}
      signOut={onSignOut}
      labels={{
        backCases: t("backCases"),
        title: t("title"),
        appearance: t("appearance"),
        darkMode: t("darkMode"),
        on: t("on"),
        off: t("off"),
        textSize: t("textSize"),
        language: t("language"),
        notifications: t("notifications"),
        notifMessages: t("notifMessages"),
        notifMeetings: t("notifMeetings"),
        notifPayments: t("notifPayments"),
        notifUpdates: t("notifUpdates"),
        myAccount: t("myAccount"),
        myDetails: t("myDetails"),
        myDetailsSub: t("myDetailsSub"),
        help: t("help"),
        helpSub: t("helpSub"),
        signOut: t("signOut"),
        soon: t("soon"),
      }}
    />
  );
}
