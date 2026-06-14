/**
 * Cita confirmada — `/caso/[caseId]/cita/[appointmentId]` · nivel CASO — DOC-51 §19.
 *
 * Server component. Reads the appointment for the client (anti-enumeration: same
 * error for not-found / not-yours → 404). Formats the dual hour server-side with
 * date-fns-tz: the client's own TZ as primary + the office TZ (Utah) as the small
 * secondary, both from the SAME UTC instant (DOC-23 §6.5) — never a fixed offset.
 *
 * The "Entrar a la videollamada" button stays visible but disabled ("Pronto")
 * because LiveKit is F7; the screen still reads naturally. Confetti fires when the
 * client just booked (`?nueva=1`).
 *
 * ADVISOR NAME: resolved via getAppointmentAdvisor (API-SCH-17, scheduling/index.ts).
 * Uses service_role to read staff_profiles; returns only {displayName, avatarUrl}.
 * requireCaseAccess enforces RLS before the profile lookup.
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import {
  getAppointmentForClient,
  getAppointmentAdvisor,
  SchedulingError,
} from "@/backend/modules/scheduling";
import { fmtHeaderDate, fmtTime, fmtTimeZoned, tzLabel } from "@/frontend/lib/datetime";
import type { Locale } from "@/frontend/features/cliente/shared/i18n";
import { CitaScreen } from "@/frontend/features/cliente/cita/cita-screen";
import { EmptyCase } from "@/frontend/features/cliente/shared/empty-case";
import { cancelAppointmentAction } from "./actions";

/**
 * Office timezone (the Utah practice — America/Denver). A stable business fact
 * used to render the small dual hour "… en Utah"; the offset itself is always
 * derived per instant by date-fns-tz, never a fixed table (DOC-23 §6.4).
 */
const OFFICE_TZ = "America/Denver";
const OFFICE_CITY_ES = "Utah";

export default async function CitaPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string; appointmentId: string }>;
  searchParams: Promise<{ nueva?: string }>;
}) {
  const { caseId, appointmentId } = await params;
  const { nueva } = await searchParams;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const clientTz = await getTimeZone();
  const t = await getTranslations("cliente.citaConfirmada");

  let appt;
  try {
    appt = await getAppointmentForClient(actor, appointmentId);
  } catch (err) {
    if (err instanceof SchedulingError && err.code === "APPT_NOT_FOUND") {
      notFound();
    }
    return <EmptyCase title={t("errTitle")} body={t("errBody")} lexMood="atento" />;
  }

  // Guard: this appointment must belong to the case in the URL.
  if (appt.case_id !== caseId) notFound();

  // Advisor lookup — non-fatal: falls back to generic if staff profile missing.
  // requireCaseAccess already passed (getAppointmentForClient enforces it), so
  // getAppointmentAdvisor will pass the same check from the cache.
  const advisorProfile = await getAppointmentAdvisor(actor, appointmentId).catch(() => null);

  const status = appt.status as
    | "scheduled"
    | "completed"
    | "cancelled"
    | "no_show"
    | "rescheduled";

  // A cancelled/rescheduled/no-show appointment is no longer the live view:
  // bounce back to the Citas tab resolver.
  if (status === "cancelled" || status === "rescheduled" || status === "no_show") {
    redirect(`/caso/${caseId}/agendar`);
  }

  const startsAt = appt.starts_at;

  // Date (client TZ) — "Jueves 12 de junio".
  const dateText = fmtHeaderDate(startsAt, clientTz, locale);

  // Dual time — client primary (with region) + office (Utah) secondary, both
  // from the same UTC instant. Region uses the friendly client TZ label.
  const clientHour = fmtTimeZoned(startsAt, clientTz); // "2:00 PM EDT"
  const clientHourPlain = fmtTime(startsAt, clientTz); // "2:00 PM"
  const region = tzLabel(clientTz, locale); // "Florida (ET)"
  const officeHour = fmtTime(startsAt, OFFICE_TZ); // "12:00 PM"
  const sameWall = clientHour === fmtTimeZoned(startsAt, OFFICE_TZ);
  const inWord = locale === "en" ? "in" : "en";
  const timeText = sameWall
    ? `${clientHourPlain} (${region})`
    : `${clientHourPlain} (${region}) · ${officeHour} ${inWord} ${OFFICE_CITY_ES}`;

  // Advisor: use real name if available; fall back to generic when not assigned.
  // DOC-51 §19 expects "{name}, tu asesora" (advisorValue key) when name is known.
  const advisorText = advisorProfile
    ? t("advisorValue", { name: advisorProfile.displayName })
    : t("advisorFallback");
  const advisorInitial = advisorProfile
    ? advisorProfile.displayName.charAt(0).toUpperCase()
    : "•";

  // Objective: the appointment note, when present.
  const objectiveText = appt.notes && status === "scheduled" ? appt.notes : null;
  const staffNote = appt.notes && status === "completed" ? appt.notes : null;

  return (
    <CitaScreen
      caseId={caseId}
      appointmentId={appointmentId}
      dateText={dateText}
      timeText={timeText}
      advisorText={advisorText}
      advisorInitial={advisorInitial}
      objectiveText={objectiveText}
      kind={(appt.kind as "video" | "phone" | "presencial") ?? "video"}
      status={status}
      staffNote={staffNote}
      celebrate={nueva === "1"}
      cancelAppointment={cancelAppointmentAction}
      labels={{
        title: t("title"),
        dateLabel: t("dateLabel"),
        timeLabel: t("timeLabel"),
        withLabel: t("withLabel"),
        objectiveLabel: t("objectiveLabel"),
        joinCall: t("joinCall"),
        callSoon: t("callSoon"),
        callSoonNote: t("callSoonNote"),
        typePhone: t("typePhone"),
        typePresencial: t("typePresencial"),
        reminderNote: t("reminderNote"),
        backHome: t("backHome"),
        reschedule: t("reschedule"),
        cancel: t("cancel"),
        completedChip: t("completedChip"),
        completedTitle: t("completedTitle"),
        completedBody: t("completedBody"),
        staffNoteLabel: t("staffNoteLabel"),
        cancelTitle: t("cancelTitle"),
        cancelBody: t("cancelBody"),
        cancelReasonPlaceholder: t("cancelReasonPlaceholder"),
        cancelKeep: t("cancelKeep"),
        cancelConfirm: t("cancelConfirm"),
        cancelling: t("cancelling"),
        errCancel: t("errCancel"),
        errReschedule: t("errReschedule"),
        errWindow: t("errWindow"),
      }}
    />
  );
}
