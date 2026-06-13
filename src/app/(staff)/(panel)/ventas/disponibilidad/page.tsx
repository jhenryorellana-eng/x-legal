/**
 * Mi disponibilidad · /ventas/disponibilidad (DOC-52 §4).
 *
 * Server Component: guards the actor and renders the availability editor wired
 * to the scheduling actions. F3 note: the current rules/exceptions/settings
 * reads land via the scheduling index; while wired the page renders the editor
 * with sensible defaults. The dev preview shows the populated view for Playwright.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { DisponibilidadView, LexPrefsProvider } from "@/frontend/features/vanessa";
import type { DayRule } from "@/frontend/features/vanessa";
import {
  saveAvailabilityRulesAction,
  addExceptionAction,
  removeExceptionAction,
  updateSchedulingSettingsAction,
  liftRebookingBlockAction,
} from "../actions";

export const dynamic = "force-dynamic";

const DAY_NAMES_ORDER: { weekday: number; key: string }[] = [
  { weekday: 1, key: "Lunes" },
  { weekday: 2, key: "Martes" },
  { weekday: 3, key: "Miércoles" },
  { weekday: 4, key: "Jueves" },
  { weekday: 5, key: "Viernes" },
  { weekday: 6, key: "Sábado" },
  { weekday: 0, key: "Domingo" },
];

export default async function VentasDisponibilidadPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const t = await getTranslations("staff.ventas.disponibilidad");

  const days: DayRule[] = DAY_NAMES_ORDER.map((d) => ({
    weekday: d.weekday,
    dayName: d.key,
    active: false,
    ranges: [],
  }));

  const strings = {
    title: t("title"),
    sub: t("sub"),
    tzChip: t("tzChip"),
    lexTipHtml: t.markup("lexTipHtml", { b: (c) => `<b>${c}</b>` }),
    weeklyTitle: t("weeklyTitle"),
    notAvailable: t("notAvailable"),
    range: t("range"),
    rulesTitle: t("rulesTitle"),
    duration: t("duration"),
    minNotice: t("minNotice"),
    videoLink: t("videoLink"),
    remindersTitle: t("remindersTitle"),
    autoReminders: t("autoReminders"),
    autoRemindersSub: t("autoRemindersSub"),
    noShowNotice: t("noShowNotice", { days: "{days}" }),
    blocksTitle: t("blocksTitle"),
    addBlock: t("addBlock"),
    save: t("save"),
    saved: t("saved"),
    rangeModalTitle: t("rangeModalTitle"),
    startLabel: t("startLabel"),
    endLabel: t("endLabel"),
    crossMidnight: t("crossMidnight"),
    cancel: t("cancel"),
    add: t("add"),
    blockModalTitle: t("blockModalTitle"),
    blockLabelField: t("blockLabelField"),
    blockReason: t("blockReason"),
    affectsNotice: t("affectsNotice", { n: "{n}" }),
    liftBlock: t("liftBlock"),
    liftBlockDone: t("liftBlockDone"),
    invalidRange: t("invalidRange"),
    lexEnabled: true,
  };

  return (
    <LexPrefsProvider>
      <DisponibilidadView
        days={days}
        exceptions={[]}
        defaultDuration={45}
        minNotice={24}
        remindersEnabled
        noShowPenaltyDays={7}
        videoLink=""
        blockedClient={null}
        strings={strings}
        actions={{
          saveRules: saveAvailabilityRulesAction,
          addException: addExceptionAction,
          removeException: removeExceptionAction,
          updateSettings: updateSchedulingSettingsAction,
          liftRebookingBlock: liftRebookingBlockAction,
        }}
      />
    </LexPrefsProvider>
  );
}
