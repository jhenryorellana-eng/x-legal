/**
 * Citas — calendar & scheduling · /ventas/citas (DOC-52 §3).
 *
 * Server Component: guards the actor, reads the week agenda from
 * `scheduling.getWeekAgenda` (M-7 DST-safe), positions events in the staff
 * timezone, composes the normative CalDay/CitaEvent shapes, and injects the
 * scheduling actions. Dual hours use formatInTimeZone over the UTC instant
 * (never fixed offsets — DOC-23 §6.5).
 *
 * Week navigation: `?week=YYYY-MM-DD` (ISO Monday). Defaults to current Monday.
 * Color-by-sequence: sequence_number 1→c1, 2→c2, ≥3→c3; lead_id present→call.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { startOfISOWeek, addDays, format } from "date-fns";
import { es as esLocale, enUS } from "date-fns/locale";
import { getActor, getCurrentUserLocation } from "@/backend/modules/identity";
import { getWeekAgenda, getAvailabilityConfig } from "@/backend/modules/scheduling";
import type { WeekAgendaResult } from "@/backend/modules/scheduling";
import { CitasClient } from "./client";
import type { CalDay, CitaEvent, CitaDetail } from "@/frontend/features/vanessa";
import { tzLabel, type Locale } from "@/frontend/lib/datetime";
import { resolveI18n } from "@/shared/i18n";
import {
  bookAppointmentAction,
  createProspectApptAction,
  completeAppointmentAction,
  cancelAppointmentAction,
  markNoShowAction,
  rescheduleAppointmentAction,
} from "../actions";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEEKDAYS_ES = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const WEEKDAYS_EN = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/**
 * Returns the ISO Monday of the week that contains `now` in `staffTz`,
 * expressed as "YYYY-MM-DD" local date string.
 */
function currentWeekStart(now: Date, staffTz: string): string {
  // Shift to staff local time then find Monday of that week.
  const zoned = toZonedTime(now, staffTz);
  const monday = startOfISOWeek(zoned);
  return format(monday, "yyyy-MM-dd");
}

/** Maps sequence_number → ApptKind used by CitaEvent. */
function seqToKind(seqNum: number | null, hasLead: boolean): CitaEvent["kind"] {
  if (hasLead || seqNum === null) return "call";
  if (seqNum === 1) return "c1";
  if (seqNum === 2) return "c2";
  return "c3";
}

/** Hour label for the hours[] slot array: "9:00", "10:00", etc. */
function hourLabel(instant: Date, staffTz: string): string {
  return formatInTimeZone(instant, staffTz, "H:mm");
}

/** Short weekday+day label for the list view: "Lun 3". */
function shortDayLabel(instant: Date, staffTz: string, locale: Locale): string {
  const zoned = toZonedTime(instant, staffTz);
  const dfLoc = locale === "en" ? enUS : esLocale;
  return format(zoned, locale === "en" ? "EEE d" : "EEE d", { locale: dfLoc });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function VentasCitasPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.ventas.citas");
  const tnc = await getTranslations("staff.ventas.nuevaCita");
  const dfLoc = locale === "en" ? enUS : esLocale;

  // --------------------------------------------------------------------------
  // 1. Resolve the week start from searchParams or current date (staff TZ)
  // --------------------------------------------------------------------------

  const sp = searchParams ? await searchParams : {};
  const now = new Date();

  // Resolve the week start in the ACTOR's own timezone (DOC-23 §6.5) so the
  // grid matches the times getWeekAgenda renders (Vanessa=Colombia, Henry=US).
  const actorTz = (await getCurrentUserLocation(actor)).timezone;

  const weekStartLocal: string =
    sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week)
      ? sp.week
      : currentWeekStart(now, actorTz);

  // --------------------------------------------------------------------------
  // 2. Fetch agenda
  // --------------------------------------------------------------------------

  let agendaResult: WeekAgendaResult;

  try {
    agendaResult = await getWeekAgenda(actor, { weekStartLocal, filter: "all" });
  } catch {
    // Fall back to empty grid rather than crashing the page.
    agendaResult = { appointments: [], staffTimezone: actorTz };
  }

  const { appointments, staffTimezone } = agendaResult;

  // Default duration for the "Nueva cita" prospect modal (Mi disponibilidad).
  const availCfg = await getAvailabilityConfig(actor).catch(() => null);
  const prospectDuration = availCfg?.prospectDurationMinutes ?? 45;

  // --------------------------------------------------------------------------
  // 3. Recalculate weekStart with the real staffTimezone (handles race where
  //    the default TZ differs from the staff's actual TZ).
  // --------------------------------------------------------------------------

  const realWeekStart =
    sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week)
      ? sp.week
      : currentWeekStart(now, staffTimezone);

  // Week boundary dates for the header sub-string.
  const weekStartDate = toZonedTime(
    new Date(`${realWeekStart}T00:00:00`),
    staffTimezone,
  );
  const weekEndDate = addDays(weekStartDate, 6);

  const weekD1 = format(weekStartDate, locale === "en" ? "MMM d" : "d 'de' MMMM", { locale: dfLoc });
  const weekD2 = format(weekEndDate,   locale === "en" ? "MMM d" : "d 'de' MMMM", { locale: dfLoc });

  // --------------------------------------------------------------------------
  // 4. Build CalDay[] for Mon–Sun of the week
  // --------------------------------------------------------------------------

  const todayLocal = format(toZonedTime(now, staffTimezone), "yyyy-MM-dd");
  const weekLabels = locale === "en" ? WEEKDAYS_EN : WEEKDAYS_ES;

  const calDays: CalDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStartDate, i);
    const dayStr = format(day, "yyyy-MM-dd");
    return {
      weekdayLabel: weekLabels[i],
      dayNumber: day.getDate(),
      isToday: dayStr === todayLocal,
    };
  });

  // --------------------------------------------------------------------------
  // 5. Collect unique hour slots from the appointments (sorted ascending).
  //    If no appointments, show a default office-hours grid.
  // --------------------------------------------------------------------------

  const slotSet = new Set<string>();
  for (const appt of appointments) {
    slotSet.add(hourLabel(appt.startsAt, staffTimezone));
  }

  const hours: string[] =
    slotSet.size > 0
      ? Array.from(slotSet).sort((a, b) => {
          const [ah, am] = a.split(":").map(Number);
          const [bh, bm] = b.split(":").map(Number);
          return ah * 60 + am - (bh * 60 + bm);
        })
      : ["9:00", "10:00", "11:00", "13:00", "14:00", "15:00"];

  // Pre-build a lookup: slot label → index in hours[]
  const slotIndex: Map<string, number> = new Map(hours.map((h, i) => [h, i]));

  // --------------------------------------------------------------------------
  // 6. Map AgendaAppointment[] → CitaEvent[] + CitaDetail map
  // --------------------------------------------------------------------------

  const events: CitaEvent[] = [];
  const details: Record<string, CitaDetail> = {};

  for (const appt of appointments) {
    // dayIndex: which column (0=Mon … 6=Sun)
    const apptDateStr = format(
      toZonedTime(appt.startsAt, staffTimezone),
      "yyyy-MM-dd",
    );
    const dayOffset = calDays.findIndex(
      (_, i) => format(addDays(weekStartDate, i), "yyyy-MM-dd") === apptDateStr,
    );
    if (dayOffset === -1) continue; // appointment outside this week view

    const slotLabel = hourLabel(appt.startsAt, staffTimezone);
    const si = slotIndex.get(slotLabel) ?? 0;

    const kind = seqToKind(appt.sequenceNumber, appt.leadId != null);
    const KIND_TO_KEY: Record<string, "legendC1" | "legendC2" | "legendC3"> = {
      c1: "legendC1",
      c2: "legendC2",
      c3: "legendC3",
    };
    const seqLabel =
      kind === "call"
        ? t("legendCall")
        : `${t(KIND_TO_KEY[kind] ?? "legendC1")} ${appt.sequenceNumber ?? ""}`.trim();

    const timeStr = formatInTimeZone(appt.startsAt, staffTimezone, "h:mm a");
    const tzAbbr  = formatInTimeZone(appt.startsAt, staffTimezone, "zzz");
    const dayLabel = shortDayLabel(appt.startsAt, staffTimezone, locale);

    events.push({
      id: appt.id,
      name: appt.clientName ?? "—",
      kind,
      seqLabel,
      dayIndex: dayOffset,
      slotIndex: si,
      done: appt.status === "completed",
      dayLabel,
      time: timeStr,
      tzAbbr,
    });

    // CitaDetail for the SidePanel
    const dayTimeStr = `${dayLabel} · ${timeStr} ${tzAbbr}`;
    details[appt.id] = {
      id: appt.id,
      name: appt.clientName ?? "—",
      dayTime: dayTimeStr,
      clientHour: null, // client TZ lookup is deferred to F4 (no client profile here)
      typeLabel: seqLabel,
      isVideo: appt.kind === "video",
      videoLink: appt.videoLink,
      status: appt.status as CitaDetail["status"],
      lexHtml: "",
      clientNote: appt.clientNote,
      notes: appt.notes,
      objectives: appt.objectives.map((o) => ({ id: o.id, text: resolveI18n(o.text, locale) })),
      objectivesOutcome: appt.objectivesOutcome,
    };
  }

  // --------------------------------------------------------------------------
  // 7. Build i18n strings
  // --------------------------------------------------------------------------

  const strings = {
    title: t("title"),
    sub: t("sub", { range: `${weekD1}–${weekD2}` }),
    newAppt: t("newAppt"),
    tzChip: t("tzChip", { region: tzLabel(staffTimezone, locale) }),
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
    completeModalTitle: t("completeModalTitle"),
    completeModalSub: t("completeModalSub"),
    achieved: t("achieved"),
    notAchieved: t("notAchieved"),
    completeNote: t("completeNote"),
    completeNotePh: t("completeNotePh"),
    confirmComplete: t("confirmComplete"),
    noObjectives: t("noObjectives"),
    outcomeTitle: t("outcomeTitle"),
    rescheduleModalTitle: t("rescheduleModalTitle"),
    rescheduleNewLabel: t("rescheduleNewLabel"),
    rescheduleConfirm: t("rescheduleConfirm"),
    rescheduledToast: t("rescheduledToast"),
    noVideoLink: t("noVideoLink"),
    clientNoteTitle: t("clientNoteTitle"),
    staffNotesTitle: t("staffNotesTitle"),
    noShowChip: t("noShowChip"),
    cancelModalTitle: t("cancelModalTitle"),
    cancelModalSub: t("cancelModalSub"),
    cancelReasonLabel: t("cancelReasonLabel"),
    cancelReasonPh: t("cancelReasonPh"),
    cancelConfirm: t("cancelConfirm"),
    cancelKeep: t("cancelKeep"),
    cancelledToast: t("cancelledToast"),
    noShowModalTitle: t("noShowModalTitle"),
    noShowModalSub: t("noShowModalSub"),
    noShowConfirm: t("noShowConfirm"),
    noShowToast: t("noShowToast"),
  };

  const nuevaCitaStrings = {
    title: tnc("title"),
    sub: tnc("sub"),
    tzChip: tnc("tzChip", { region: tzLabel(staffTimezone, locale) }),
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
      staffTz={staffTimezone}
      locale={locale}
      strings={strings}
      nuevaCitaStrings={nuevaCitaStrings}
      prospectDuration={prospectDuration}
      actions={{
        book: bookAppointmentAction,
        prospect: createProspectApptAction,
        complete: completeAppointmentAction,
        reschedule: rescheduleAppointmentAction,
        cancel: cancelAppointmentAction,
        noShow: markNoShowAction,
      }}
    />
  );
}
