/**
 * Mi proceso — `/caso/[caseId]/proceso` · nivel CASO (pestaña "Más") — DOC-51 §22.
 *
 * Server component. Reads the service milestones with case-derived states
 * (getCaseMilestones) + the client name. Glossary terms come from each
 * milestone's `glossary_i18n` (bilingual, admin-managed).
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getCaseMilestones, getClientDisplayName, getCaseTimeline } from "@/backend/modules/cases";
import { pickLocale, coerceIcon, type Locale } from "@/frontend/features/cliente/shared/i18n";
import {
  ProcesoScreen,
  type ProcesoMilestone,
  type ProcesoCronograma,
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
  const t = await getTranslations("cliente.proceso");

  let dto;
  try {
    dto = await getCaseMilestones(actor, caseId);
  } catch {
    notFound();
  }
  const name = (await getClientDisplayName(actor)) ?? t("fallbackName");

  // Cronograma — expressed in weeks relative to case start (no specific dates;
  // the estimates never read as a commitment). Anchored on opened_at upstream.
  const timeline = await getCaseTimeline(actor, caseId).catch(() => null);
  const cronograma: ProcesoCronograma | null =
    timeline && timeline.citas.length > 0
      ? {
          citas: timeline.citas.map((c) => ({
            label: pickLocale(c.citaLabelI18n, locale) || t("citaN", { n: c.sequenceNumber }),
            weekLabel: t("weekN", { n: c.weekOffset }),
          })),
          started: timeline.started,
          totalWeeksLabel: t("totalWeeks", { n: timeline.totalWeeks }),
        }
      : null;

  const milestones: ProcesoMilestone[] = dto.milestones.map((m) => {
    const glossaryBody = pickLocale(m.glossaryI18n, locale);
    return {
      id: m.id,
      title: pickLocale(m.labelI18n, locale),
      description: pickLocale(m.descriptionI18n, locale),
      icon: coerceIcon(m.icon, "doc"),
      state: m.state,
      progress: m.progress,
      glossary: glossaryBody
        ? { term: pickLocale(m.labelI18n, locale), body: glossaryBody }
        : null,
    };
  });

  return (
    <ProcesoScreen
      caseId={caseId}
      milestones={milestones}
      cronograma={cronograma}
      labels={{
        back: t("back"),
        title: t("title", { name }),
        subtitle: t("subtitle", { x: dto.phaseIndex, y: dto.phaseCount }),
        inProgress: t("inProgress"),
        next: t("next"),
        progress: t("progress"),
        completed: t("completed"),
        whatDoesThisMean: t("whatDoesThisMean"),
        gotIt: t("gotIt"),
        whatsNext: t("whatsNext"),
        whatsNextBody: t("whatsNextBody"),
        cronogramaTitle: t("cronogramaTitle"),
        deliveryEstimate: t("deliveryEstimate"),
        cronogramaNotStarted: t("cronogramaNotStarted"),
      }}
    />
  );
}
