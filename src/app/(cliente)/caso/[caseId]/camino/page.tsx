/**
 * Tu Camino — `/caso/[caseId]/camino` · nivel CASO (pestaña "Inicio") — DOC-51 §13.
 *
 * Server component. Reads the case workspace (service/phase/progress/parties) and
 * the documents matrix counts to drive the single "Tu siguiente paso" CTA, plus
 * the first milestone for the "Mi proceso" strip. The `?onboarded=1` query param
 * (set by the disclaimer on first accept) fires the Tutorial overlay.
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import {
  getCaseWorkspace,
  getDocumentsMatrix,
  getCaseMilestones,
  getCaseTimeline,
} from "@/backend/modules/cases";
import { getCaseAppointments } from "@/backend/modules/scheduling";
import { fmtDateShort, fmtTime } from "@/frontend/lib/datetime";
import { pickLocale, type Locale } from "@/frontend/features/cliente/shared/i18n";
import { CaminoScreen } from "@/frontend/features/cliente/camino/camino-screen";

export default async function CaminoPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ onboarded?: string }>;
}) {
  const { caseId } = await params;
  const { onboarded } = await searchParams;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const tz = await getTimeZone();
  const t = await getTranslations("cliente.camino");

  let ws, docs, milestonesDto;
  try {
    ws = await getCaseWorkspace(actor, caseId);
    docs = await getDocumentsMatrix(actor, caseId);
    milestonesDto = await getCaseMilestones(actor, caseId);
  } catch {
    notFound();
  }

  const serviceName = pickLocale(ws.service?.labelI18n, locale);
  const party = ws.parties[0]?.name ?? null;
  const caseTitle = party ? t("caseOf", { party }) : serviceName;
  const phaseName = pickLocale(ws.phase?.labelI18n, locale);
  const phaseDescription = pickLocale(ws.phase?.descriptionI18n, locale);

  const docsComplete = docs.total > 0 && docs.done >= docs.total;
  const currentMilestone = milestonesDto.milestones.find((m) => m.state === "current");
  const currentMilestoneLabel = currentMilestone
    ? pickLocale(currentMilestone.labelI18n, locale)
    : null;

  // Next scheduled appointment (real) — drives the "Próxima cita" tile. The list
  // is ordered by starts_at asc, so the first future `scheduled` one is the next.
  const appointments = await getCaseAppointments(actor, caseId).catch(() => []);
  const nowMs = Date.now();
  const nextAppt =
    appointments.find(
      (a) => a.status === "scheduled" && new Date(a.starts_at).getTime() > nowMs,
    ) ?? null;
  const nextMeetingValue = nextAppt
    ? `${fmtDateShort(nextAppt.starts_at, tz, locale)}, ${fmtTime(nextAppt.starts_at, tz)}`
    : null;
  const nextMeetingHref = nextAppt
    ? `/caso/${caseId}/cita/${nextAppt.id}`
    : `/caso/${caseId}/agendar`;

  // Estimated delivery — expressed in weeks (no specific dates, §cronograma).
  const timeline = await getCaseTimeline(actor, caseId).catch(() => null);
  const deliveryLabel =
    timeline && timeline.totalWeeks > 0
      ? t("deliveryWeeks", { n: timeline.totalWeeks })
      : null;

  return (
    <CaminoScreen
      caseId={caseId}
      serviceName={serviceName}
      caseTitle={caseTitle}
      partyInitial={(party ?? serviceName).charAt(0).toUpperCase() || "U"}
      fullServiceName={serviceName}
      phaseIndex={ws.phaseIndex}
      phaseCount={ws.phaseCount}
      phaseName={phaseName}
      phaseDescription={phaseDescription}
      progress={ws.phaseProgress}
      docsDone={docs.done}
      docsTotal={docs.total}
      docsPending={ws.pendingDocuments}
      docsComplete={docsComplete}
      firstVisit={onboarded === "1"}
      currentMilestoneLabel={currentMilestoneLabel}
      nextMeetingValue={nextMeetingValue}
      nextMeetingHref={nextMeetingHref}
      deliveryLabel={deliveryLabel}
      labels={{
        backCases: t("backCases"),
        deliveryEstimate: t("deliveryEstimate"),
        // These carry ICU placeholders ({service}/{x}/{y}/{n}/{phase}) that the
        // screen fills via string replace — use t.raw so next-intl returns the
        // template literally instead of failing to format the missing vars.
        encourageSuffix: t.raw("encourage") as string,
        phaseChip: t.raw("phaseChip") as string,
        nextStep: t("nextStep"),
        nextDocsTitle: t.raw("nextDocsTitle") as string,
        nextDocsBody: t("nextDocsBody"),
        nextFormTitle: t("nextFormTitle"),
        nextFormBody: t("nextFormBody"),
        continue: t("continue"),
        myProcess: t("myProcess"),
        view: t("view"),
        inProgressSuffix: t("inProgressSuffix"),
        nextMeeting: t("nextMeeting"),
        documents: t("documents"),
        documentsValue: t.raw("documentsValue") as string,
        forms: t("forms"),
        formsValue: t.raw("formsValue") as string,
        noMeeting: t("noMeeting"),
      }}
      tutorialLabels={{
        step1Title: t("tutorial.step1Title"),
        step1Body: t("tutorial.step1Body"),
        step2Title: t("tutorial.step2Title"),
        step2Body: t("tutorial.step2Body"),
        step3Title: t("tutorial.step3Title"),
        step3Body: t("tutorial.step3Body"),
        skip: t("tutorial.skip"),
        next: t("tutorial.next"),
        done: t("tutorial.done"),
      }}
    />
  );
}
