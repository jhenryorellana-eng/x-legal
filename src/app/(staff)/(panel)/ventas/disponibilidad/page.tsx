/**
 * Mi disponibilidad · /ventas/disponibilidad (DOC-52 §4).
 *
 * Server Component: guards the actor and renders the availability editor wired
 * to the scheduling actions. F3 note: the current rules/exceptions/settings
 * reads land via the scheduling index; while wired the page renders the editor
 * with sensible defaults. The dev preview shows the populated view for Playwright.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { formatInTimeZone } from "date-fns-tz";
import { getActor } from "@/backend/modules/identity";
import { getAvailabilityConfig } from "@/backend/modules/scheduling";
import { tzLabel } from "@/frontend/lib/datetime";
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
  const locale = (await getLocale()) === "en" ? "en" : "es";

  // Read the rep's saved availability (weekly rules + exceptions + settings).
  // Falls back to empty defaults if the read fails (e.g. missing permission) so
  // the editor still renders rather than crashing the panel.
  const config = await getAvailabilityConfig(actor).catch(() => null);
  const staffTz = config?.staffTimezone ?? "America/New_York";

  // Group the flat active rules into per-weekday ranges for the editor.
  const rangesByWeekday = new Map<number, { start: string; end: string }[]>();
  for (const r of config?.rules ?? []) {
    if (!r.isActive) continue;
    const list = rangesByWeekday.get(r.weekday) ?? [];
    list.push({ start: r.startLocal, end: r.endLocal });
    rangesByWeekday.set(r.weekday, list);
  }

  const days: DayRule[] = DAY_NAMES_ORDER.map((d) => {
    const ranges = rangesByWeekday.get(d.weekday) ?? [];
    return {
      weekday: d.weekday,
      dayName: d.key,
      active: ranges.length > 0,
      ranges,
    };
  });

  const exceptions = (config?.exceptions ?? []).map((e) => ({
    id: e.id,
    label: e.reason ?? t("blockReason"),
    rangeLabel: `${formatInTimeZone(new Date(e.startsAt), staffTz, "d/MM HH:mm")} – ${formatInTimeZone(
      new Date(e.endsAt),
      staffTz,
      "d/MM HH:mm",
    )}`,
    affectedCount: 0,
  }));

  const minNotice = config?.minNoticeHours ?? 24;
  const noShowPenaltyDays = config?.rebookingPenaltyDays ?? 7;
  const prospectDuration = config?.prospectDurationMinutes ?? 45;

  const strings = {
    title: t("title"),
    sub: t("sub"),
    tzChip: t("tzChip", { region: tzLabel(staffTz, locale) }),
    lexTipHtml: t.markup("lexTipHtml", { b: (c) => `<b>${c}</b>` }),
    weeklyTitle: t("weeklyTitle"),
    notAvailable: t("notAvailable"),
    range: t("range"),
    rulesTitle: t("rulesTitle"),
    duration: t("duration"),
    minNotice: t("minNotice"),
    videoLink: t("videoLink"),
    videoLinkPh: t("videoLinkPh"),
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
    blockFromLabel: t("blockFromLabel"),
    blockToLabel: t("blockToLabel"),
    blockInvalidRange: t("blockInvalidRange"),
    blockAffectsConfirm: t("blockAffectsConfirm", { n: "{n}" }),
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
        exceptions={exceptions}
        defaultDuration={prospectDuration}
        minNotice={minNotice}
        remindersEnabled={config?.remindersEnabled ?? true}
        noShowPenaltyDays={noShowPenaltyDays}
        videoLink={config?.videoLink ?? ""}
        staffTz={staffTz}
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
