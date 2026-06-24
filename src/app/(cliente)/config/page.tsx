/**
 * Configuración — `/config` · nivel CUENTA (DOC-51 §11).
 *
 * Server component. Resolves the current locale and injects `signOutAction`
 * (DOC-50 §2) into the client ConfigScreen, which owns theme / text-scale /
 * language toggles (local + cookie, no flash).
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations, getTimeZone } from "next-intl/server";
import { getActor, getCurrentUserLocation } from "@/backend/modules/identity";
import { signOutAction, setUserLocaleAction, setUserTimezoneAction, setUserLocationAction } from "@/backend/modules/identity/actions";
import { getPreferences } from "@/backend/modules/notifications";
import {
  updatePreferencesAction,
  registerPushSubscriptionAction,
  removePushSubscriptionAction,
} from "@/backend/modules/notifications/actions";
import {
  ConfigScreen,
  type ConfigPrefs,
} from "@/frontend/features/cliente/config/config-screen";

export default async function ConfigPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as "es" | "en";
  const timeZone = await getTimeZone();
  const t = await getTranslations("cliente.config");
  const prefs = await getPreferences(actor);
  const loc = await getCurrentUserLocation(actor);

  async function onSignOut() {
    "use server";
    await signOutAction();
    redirect("/welcome");
  }

  async function onUpdatePrefs(patch: Partial<ConfigPrefs>) {
    "use server";
    await updatePreferencesAction(patch);
  }

  return (
    <ConfigScreen
      initialLocale={locale}
      initialTimezone={timeZone}
      initialCity={loc.city}
      initialCountry={loc.country}
      signOut={onSignOut}
      setLocale={setUserLocaleAction}
      setTimezone={setUserTimezoneAction}
      setLocation={setUserLocationAction}
      initialPrefs={{
        messages: prefs.messages,
        appointment_reminders: prefs.appointment_reminders,
        payment_reminders: prefs.payment_reminders,
        case_updates: prefs.case_updates,
      }}
      updatePrefs={onUpdatePrefs}
      push={{
        vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        registerAction: registerPushSubscriptionAction,
        removeAction: removePushSubscriptionAction,
      }}
      labels={{
        backCases: t("backCases"),
        title: t("title"),
        appearance: t("appearance"),
        darkMode: t("darkMode"),
        on: t("on"),
        off: t("off"),
        textSize: t("textSize"),
        language: t("language"),
        timezone: t("timezone"),
        timezoneSub: t("timezoneSub"),
        timezoneDetect: t("timezoneDetect"),
        timezoneDetecting: t("timezoneDetecting"),
        timezoneLocation: t("timezoneLocation"),
        timezoneUnavailable: t("timezoneUnavailable"),
        notifications: t("notifications"),
        notifMessages: t("notifMessages"),
        notifMeetings: t("notifMeetings"),
        notifPayments: t("notifPayments"),
        notifUpdates: t("notifUpdates"),
        notifPush: t("notifPush"),
        notifPushAlert: t("notifPushAlert"),
        notifPushUnsupported: t("notifPushUnsupported"),
        notifPushDenied: t("notifPushDenied"),
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
