/**
 * Mis datos del caso — `/caso/[caseId]/datos` · nivel CASO (pestaña "Más") — DOC-51 §24.
 *
 * Server component, read-only. Service, case number ({PREFIX}{YY}-{NNNNNN}), current
 * phase, account holder + a row per party, and the user's timezone label.
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getCaseWorkspace, getClientDisplayName } from "@/backend/modules/cases";
import { pickLocale, coerceIcon, type Locale } from "@/frontend/features/cliente/shared/i18n";
import { DatosScreen, type DatosRow } from "@/frontend/features/cliente/datos/datos-screen";

// Friendly timezone labels (DOC-23 §5) — a small curated map; falls back to IANA.
const TZ_LABELS: Record<string, string> = {
  "America/New_York": "Florida (ET)",
  "America/Chicago": "Texas (CT)",
  "America/Denver": "Utah (MT)",
  "America/Los_Angeles": "California (PT)",
  "America/Phoenix": "Arizona (MST)",
};

export default async function DatosPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const tz = await getTimeZone();
  const t = await getTranslations("cliente.datos");

  let ws;
  try {
    ws = await getCaseWorkspace(actor, caseId);
  } catch {
    notFound();
  }
  const holder = (await getClientDisplayName(actor)) ?? "—";

  // Party role labels are data-driven; cast the translator for dynamic keys.
  const tRole = t as unknown as (key: string) => string;
  const PARTY_ROLE_KEYS = new Set([
    "primary_applicant",
    "co_applicant",
    "spouse",
    "dependent",
    "guarantor",
  ]);
  const roleLabel = (role: string) =>
    PARTY_ROLE_KEYS.has(role) ? tRole(`partyRole.${role}`) : tRole("partyRole.default");

  const serviceName = pickLocale(ws.service?.labelI18n, locale);
  const phaseName = pickLocale(ws.phase?.labelI18n, locale);
  // Single-phase services (e.g. Asilo) show just the phase name — "Fase 1 de 1"
  // is noise when there's only one phase.
  const phaseValue = ws.phase
    ? ws.phaseCount > 1
      ? t("phaseValue", { x: ws.phaseIndex, y: ws.phaseCount, phase: phaseName })
      : phaseName
    : "—";

  const rows: DatosRow[] = [
    {
      icon: coerceIcon(ws.service?.icon, "shield"),
      color: "var(--accent)",
      label: t("service"),
      value: serviceName || "—",
    },
    {
      icon: "briefcase",
      color: "var(--navy)",
      label: t("caseNumber"),
      value: `#${ws.caseNumber}`,
    },
    {
      icon: "map",
      color: "var(--gold)",
      label: t("currentPhase"),
      value: phaseValue,
    },
    {
      icon: "user",
      color: "var(--green)",
      label: t("accountHolder"),
      value: holder,
    },
    // A row per non-holder party (e.g. the minor).
    ...ws.parties
      .filter((p) => p.name)
      .map((p) => ({
        icon: "family" as const,
        color: "var(--purple, #7C5CFF)",
        label: roleLabel(p.role),
        value: p.name as string,
      })),
    {
      icon: "clock",
      color: "var(--ink-2)",
      label: t("timezone"),
      value: TZ_LABELS[tz] ?? tz,
    },
  ];

  return <DatosScreen caseId={caseId} title={t("title")} back={t("back")} rows={rows} />;
}
