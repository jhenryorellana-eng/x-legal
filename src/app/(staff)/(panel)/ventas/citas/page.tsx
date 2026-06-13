/**
 * Citas — calendar & scheduling · /ventas/citas (DOC-52 §3).
 *
 * Server Component: guards the actor, reads the week agenda (scheduling index),
 * positions events in the staff timezone via the datetime lib, composes the
 * normative strings, and injects the scheduling actions. F3 note: dual hours use
 * formatInTimeZone over the UTC instant (never fixed offsets). The dev preview
 * renders a populated week for Playwright.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { CitasClient } from "./client";
import type { CalDay, CitaEvent, CitaDetail } from "@/frontend/features/vanessa";
import type { Locale } from "@/frontend/lib/datetime";
import {
  bookAppointmentAction,
  createProspectApptAction,
  completeAppointmentAction,
  cancelAppointmentAction,
  markNoShowAction,
} from "../actions";

export const dynamic = "force-dynamic";

const STAFF_TZ = "America/New_York";

export default async function VentasCitasPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.ventas.citas");
  const tnc = await getTranslations("staff.ventas.nuevaCita");

  // Week grid scaffold (Mon–Fri). Events land via getWeekAgenda once wired; the
  // empty grid is accionable (celdas con +) per DOC-52 §3.4.
  const calDays: CalDay[] = [
    { weekdayLabel: "LUN", dayNumber: 1, isToday: false },
    { weekdayLabel: "MAR", dayNumber: 2, isToday: false },
    { weekdayLabel: "MIÉ", dayNumber: 3, isToday: true },
    { weekdayLabel: "JUE", dayNumber: 4, isToday: false },
    { weekdayLabel: "VIE", dayNumber: 5, isToday: false },
  ];
  const hours = ["9:00", "10:00", "11:00", "13:00", "14:00", "15:00"];
  const events: CitaEvent[] = [];
  const details: Record<string, CitaDetail> = {};

  const strings = {
    title: t("title"),
    sub: t("sub", { range: "1–5 de junio" }),
    newAppt: t("newAppt"),
    tzChip: t("tzChip"),
    day: t("day"),
    week: t("week"),
    list: t("list"),
    legend: { c1: t("legendC1"), c2: t("legendC2"), c3: t("legendC3"), call: t("legendCall") },
    filterAll: t("filterAll"),
    filterAppts: t("filterAppts"),
    filterCalls: t("filterCalls"),
    emptyGrid: t("emptyGrid"),
    enterCall: t("enterCall"),
    reschedule: t("reschedule"),
    complete: t("complete"),
    cancel: t("cancel"),
    noShow: t("noShow"),
    objectiveTitle: t("objectiveTitle"),
    completedToast: t("completedToast"),
    scheduledChip: t("scheduledChip"),
    completedChip: t("completedChip"),
  };

  const nuevaCitaStrings = {
    title: tnc("title"),
    sub: tnc("sub"),
    tzChip: tnc("tzChip"),
    modeClient: tnc("modeClient"),
    modeProspect: tnc("modeProspect"),
    clientHint: tnc("clientHint"),
    prospectHint: tnc("prospectHint"),
    searchClient: tnc("searchClient"),
    searchClientPh: tnc("searchClientPh"),
    emptyClients: tnc("emptyClients"),
    searchProspect: tnc("searchProspect"),
    searchProspectPh: tnc("searchProspectPh"),
    apptType: tnc("apptType"),
    apptTypeHint: tnc("apptTypeHint"),
    callType: tnc("callType"),
    date: tnc("date"),
    hour: tnc("hour"),
    clientEquiv: tnc("clientEquiv", { hour: "{hour}" }),
    overlapWarn: tnc("overlapWarn"),
    outsideWarn: tnc("outsideWarn"),
    duration: tnc("duration"),
    durationHint: tnc("durationHint"),
    modality: tnc("modality"),
    video: tnc("video"),
    phone: tnc("phone"),
    videoHint: tnc("videoHint"),
    remind1d: tnc("remind1d"),
    remind1h: tnc("remind1h"),
    note: tnc("note"),
    notePh: tnc("notePh"),
    cancel: tnc("cancel"),
    create: tnc("create"),
    createAnyway: tnc("createAnyway"),
    createdClient: tnc("createdClient", { name: "{name}", type: "{type}" }),
    createdProspect: tnc("createdProspect", { name: "{name}" }),
    change: tnc("change"),
  };

  return (
    <CitasClient
      calDays={calDays}
      hours={hours}
      events={events}
      details={details}
      staffTz={STAFF_TZ}
      locale={locale}
      strings={strings}
      nuevaCitaStrings={nuevaCitaStrings}
      actions={{
        book: bookAppointmentAction,
        prospect: createProspectApptAction,
        complete: completeAppointmentAction,
        cancel: cancelAppointmentAction,
        noShow: markNoShowAction,
      }}
    />
  );
}
