/**
 * Más (hub del caso) — `/caso/[caseId]/mas` · nivel CASO (pestaña "Más") — DOC-51 §26.
 *
 * Server component. Header shows service — party · #case_number. Items that arrive
 * in later phases (Mis expedientes / Documentos de mi equipo / overlays Apoyo)
 * render with a "Pronto" badge per the brief.
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getCaseWorkspace } from "@/backend/modules/cases";
import { pickLocale, type Locale } from "@/frontend/features/cliente/shared/i18n";
import { MasScreen, type MasGroup } from "@/frontend/features/cliente/mas/mas-screen";

export default async function MasPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.mas");

  let ws;
  try {
    ws = await getCaseWorkspace(actor, caseId);
  } catch {
    notFound();
  }

  const serviceName = pickLocale(ws.service?.labelI18n, locale);
  const party = ws.parties[0]?.name;
  const subtitle = `${party ? `${serviceName} — ${party}` : serviceName} · #${ws.caseNumber}`;

  const groups: MasGroup[] = [
    {
      label: t("groupYourCase"),
      items: [
        {
          icon: "route",
          color: "var(--accent)",
          title: t("myProcess"),
          description: t("myProcessDesc"),
          href: `/caso/${caseId}/proceso`,
        },
        {
          icon: "clock",
          color: "var(--gold)",
          title: t("caseHistory"),
          description: t("caseHistoryDesc"),
          href: `/caso/${caseId}/bitacora`,
        },
        {
          icon: "user",
          color: "var(--navy)",
          title: t("caseDetails"),
          description: t("caseDetailsDesc"),
          href: `/caso/${caseId}/datos`,
        },
      ],
    },
    {
      label: t("groupDocuments"),
      items: [
        // Mis expedientes / Documentos de mi equipo arrive in a later wave.
        {
          icon: "doc",
          color: "var(--green)",
          title: t("myFiles"),
          description: t("myFilesDesc"),
          href: null,
          soon: true,
        },
        {
          icon: "briefcase",
          color: "var(--accent)",
          title: t("teamDocuments"),
          description: t("teamDocumentsDesc"),
          href: null,
          soon: true,
        },
      ],
    },
    {
      label: t("groupSupport"),
      items: [
        {
          icon: "chat",
          color: "var(--accent)",
          title: t("talkToTeam"),
          description: t("talkToTeamDesc"),
          href: null,
          soon: true,
        },
        {
          icon: "help",
          color: "var(--gold-deep)",
          title: t("help"),
          description: t("helpDesc"),
          href: null,
          soon: true,
        },
      ],
    },
  ];

  return (
    <MasScreen
      header={t("header")}
      subtitle={subtitle}
      back={t("back")}
      soonLabel={t("soon")}
      groups={groups}
    />
  );
}
