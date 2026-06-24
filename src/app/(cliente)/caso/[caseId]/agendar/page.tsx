/**
 * Agendar cita — `/caso/[caseId]/agendar` · nivel CASO (pestaña "Citas") — DOC-51 §18.
 *
 * Server component. This route is the default "Citas" tab target. Per the router
 * resolution (§0.1): if a scheduled appointment already exists we redirect to the
 * confirmed screen; otherwise we render the scheduler.
 *
 * The initial slot window covers the current local month; the client refetches
 * other months via getSlotsAction. Slots arrive as UTC ISO and the client renders
 * the dual hour (its TZ big / staff TZ small) with date-fns-tz — never a fixed
 * offset (DOC-23 §6.4). REBOOKING_BLOCKED → empathetic block screen with the
 * unblock date; no slots / NO_APPOINTMENTS_LEFT → friendly empty state.
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import {
  getAvailableSlots,
  getCaseAppointments,
  SchedulingError,
} from "@/backend/modules/scheduling";
import { tzLabel } from "@/frontend/lib/datetime";
import { fmtDateFull } from "@/frontend/lib/datetime";
import type { Locale } from "@/frontend/features/cliente/shared/i18n";
import { AgendarScreen } from "@/frontend/features/cliente/agendar/agendar-screen";
import { AgendarBlocked } from "@/frontend/features/cliente/agendar/agendar-blocked";
import { EmptyCase } from "@/frontend/features/cliente/shared/empty-case";
import { getSlotsAction, bookAppointmentAction } from "./actions";
import { rescheduleAppointmentAction } from "../cita/[appointmentId]/actions";

/**
 * Initial UTC window: ~36 days from "now". Guarantees the visible (current) month
 * plus a margin; the client refetches per month as the user navigates the
 * calendar via getSlotsAction.
 */
function initialWindowUtc(): { from: Date; to: Date } {
  const now = new Date();
  return {
    from: new Date(now.getTime() - 86_400_000),
    to: new Date(now.getTime() + 36 * 86_400_000),
  };
}

export default async function AgendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ reschedule?: string }>;
}) {
  const { caseId } = await params;
  const { reschedule } = await searchParams;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const clientTz = await getTimeZone();
  const t = await getTranslations("cliente.agendar");

  const isReschedule = Boolean(reschedule);

  // Router resolution (§0.1): a scheduled appointment → confirmed screen — UNLESS
  // the client is explicitly rescheduling THAT appointment (pick a new slot).
  let appointments;
  try {
    appointments = await getCaseAppointments(actor, caseId);
  } catch {
    notFound();
  }
  const scheduled = appointments.find((a) => a.status === "scheduled");
  if (scheduled && !isReschedule) {
    redirect(`/caso/${caseId}/cita/${scheduled.id}`);
  }

  const win = initialWindowUtc();

  // Materialise the initial slots; map known errors to dedicated screens.
  try {
    const result = await getAvailableSlots(actor, {
      caseId,
      windowFromUtc: win.from,
      windowToUtc: win.to,
    });

    const initialSlots = result.slots.map((s) => ({
      startUtc: s.startUtc.toISOString(),
      endUtc: s.endUtc.toISOString(),
    }));

    if (initialSlots.length === 0) {
      return (
        <EmptyCase title={t("emptyTitle")} body={t("emptyBody")} lexMood="atento" />
      );
    }

    return (
      <AgendarScreen
        caseId={caseId}
        clientTimezone={clientTz}
        staffTimezone={result.staffTimezone}
        initialSlots={initialSlots}
        durationMinutes={result.durationMinutes}
        sequenceNumber={result.sequenceNumber}
        // The policy's total appointment count is not exposed by the slots read;
        // we only surface the "Cita n de m" context when the sequence is >1, and
        // use the sequence as the total placeholder until the policy DTO lands.
        appointmentCount={result.sequenceNumber > 1 ? result.sequenceNumber : 1}
        locale={locale}
        rescheduleAppointmentId={isReschedule ? reschedule : null}
        getSlots={getSlotsAction}
        book={bookAppointmentAction}
        reschedule={rescheduleAppointmentAction}
        labels={{
          title: t("title"),
          subtitle: t("subtitle"),
          // Raw template: AgendarScreen fills {region} client-side (next-intl would
          // otherwise fail the ICU format on the missing arg and echo the key).
          bannerTz: t.raw("bannerTz"),
          region: tzLabel(clientTz, locale),
          monthAria: t("monthAria"),
          prevMonth: t("prevMonth"),
          nextMonth: t("nextMonth"),
          weekdays: t("weekdays"),
          // Raw templates: the screen fills {date} / {hora} / {n}/{total} client-side.
          slotsTitle: t.raw("slotsTitle"),
          slotsLoading: t("slotsLoading"),
          pickDayFirst: t("pickDayFirst"),
          noSlotsDay: t("noSlotsDay"),
          remindersTitle: t("remindersTitle"),
          reminder1d: t("reminder1d"),
          reminder1h: t("reminder1h"),
          noteLabel: t("noteLabel"),
          notePlaceholder: t("notePlaceholder"),
          penaltyNotice: t("penaltyNotice"),
          ctaIdle: t("ctaIdle"),
          ctaReady: t("ctaReady"),
          ctaReschedule: t("ctaReschedule"),
          ctaBooking: t("ctaBooking"),
          inOffice: t.raw("inOffice"),
          seqLabel: t.raw("seqLabel"),
          errSlotTaken: t("errSlotTaken"),
          errNoLeft: t("errNoLeft"),
          errGeneric: t("errGeneric"),
          errWindow: t("errWindow"),
          back: t("back"),
        }}
      />
    );
  } catch (err) {
    if (err instanceof SchedulingError) {
      if (err.code === "REBOOKING_BLOCKED") {
        const raw = err.meta?.["blockedUntil"];
        const until =
          raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : null;
        const unblockDate = until ? fmtDateFull(until, clientTz, locale) : "";
        return (
          <AgendarBlocked
            title={t("blockedTitle")}
            body={t.raw("blockedBody")}
            hint={t("blockedHint")}
            unblockDate={unblockDate}
          />
        );
      }
      if (err.code === "NO_APPOINTMENTS_LEFT") {
        return (
          <EmptyCase title={t("emptyTitle")} body={t("emptyBody")} lexMood="atento" />
        );
      }
      // CASE_NOT_ACTIVE / NO_STAFF_ASSIGNED → friendly empty rather than a 500.
      return (
        <EmptyCase title={t("emptyTitle")} body={t("emptyBody")} lexMood="atento" />
      );
    }
    notFound();
  }
}
