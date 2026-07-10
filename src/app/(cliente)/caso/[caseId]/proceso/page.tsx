/**
 * Mi proceso — `/caso/[caseId]/proceso` · nivel CASO (pestaña "Más") — DOC-51 §22.
 *
 * Server component. Reads the unified progress timeline (getCaseProgressTimeline):
 * legal milestones (states from the case's current milestone) interleaved with the
 * service's citas (booked date or "Agendar"), ordered by week. Glossary terms come
 * from each milestone's `glossary_i18n` (bilingual, admin-managed).
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getCaseProgressTimeline, getClientDisplayName } from "@/backend/modules/cases";
import { fmtDateShort, fmtTime } from "@/frontend/lib/datetime";
import { pickLocale, coerceIcon, type Locale } from "@/frontend/features/cliente/shared/i18n";
import {
  ProcesoScreen,
  type ProcesoTimelineItem,
} from "@/frontend/features/cliente/proceso/proceso-screen";

export default async function ProcesoPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const tz = await getTimeZone();
  const t = await getTranslations("cliente.proceso");

  let dto;
  try {
    dto = await getCaseProgressTimeline(actor, caseId);
  } catch {
    notFound();
  }
  const name = (await getClientDisplayName(actor)) ?? t("fallbackName");

  const items: ProcesoTimelineItem[] = dto.items.map((it): ProcesoTimelineItem => {
    if (it.kind === "milestone") {
      const glossaryBody = pickLocale(it.glossaryI18n, locale);
      const title = pickLocale(it.labelI18n, locale);
      return {
        kind: "milestone",
        id: it.id,
        title,
        description: pickLocale(it.descriptionI18n, locale),
        icon: coerceIcon(it.icon, "doc"),
        state: it.state,
        progress: it.progress,
        weekLabel: it.weekOffset != null ? t("weekN", { n: it.weekOffset }) : null,
        glossary: glossaryBody ? { term: title, body: glossaryBody } : null,
      };
    }
    // appointment
    const dateLabel = it.startsAt
      ? `${fmtDateShort(it.startsAt, tz, locale)}, ${fmtTime(it.startsAt, tz)}`
      : null;
    return {
      kind: "appointment",
      id: it.id,
      title: pickLocale(it.labelI18n, locale) || t("citaN", { n: it.sequenceNumber }),
      status: it.status,
      weekLabel: t("weekN", { n: it.weekOffset }),
      dateLabel,
      href: it.appointmentId
        ? `/caso/${caseId}/cita/${it.appointmentId}`
        : `/caso/${caseId}/agendar`,
    };
  });

  return (
    <ProcesoScreen
      caseId={caseId}
      items={items}
      labels={{
        back: t("back"),
        title: t("title", { name }),
        subtitle:
          dto.phaseCount > 1
            ? t("subtitle", { x: dto.phaseIndex, y: dto.phaseCount })
            : t("subtitleSingle"),
        inProgress: t("inProgress"),
        next: t("next"),
        progress: t("progress"),
        completed: t("completed"),
        whatDoesThisMean: t("whatDoesThisMean"),
        gotIt: t("gotIt"),
        whatsNext: t("whatsNext"),
        whatsNextBody: t("whatsNextBody"),
        appointmentPill: t("appointmentPill"),
        appointmentDone: t("appointmentDone"),
        book: t("book"),
        deliveryEstimate: t("deliveryEstimate"),
        totalWeeksLabel: t("totalWeeks", { n: dto.totalWeeks }),
        notStarted: dto.started ? null : t("cronogramaNotStarted"),
      }}
    />
  );
}
