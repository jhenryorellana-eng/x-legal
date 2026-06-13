/**
 * Corregir documento (RFE) — `/caso/[caseId]/corregir?req&party&doc` — DOC-51 §17.
 *
 * Server component. Reads the documents matrix and resolves the rejected
 * requirement's reason + optional deadline. AMBER tone, never red.
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getDocumentsMatrix } from "@/backend/modules/cases";
import { pickLocale, type Locale } from "@/frontend/features/cliente/shared/i18n";
import { CorregirScreen } from "@/frontend/features/cliente/documentos/corregir-screen";

export default async function CorregirPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ req?: string; party?: string; doc?: string }>;
}) {
  const { caseId } = await params;
  const { req, party } = await searchParams;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.corregir");

  let matrix;
  try {
    matrix = await getDocumentsMatrix(actor, caseId);
  } catch {
    notFound();
  }

  // Resolve the rejected requirement (by req+party, else first "corregir").
  const target =
    matrix.items.find(
      (d) => d.requirementId === (req ?? null) && d.partyId === (party ?? null),
    ) ?? matrix.items.find((d) => d.status === "corregir");

  if (!target) notFound();

  const baseLabel = pickLocale(target.labelI18n, locale);
  const documentName = target.partyName
    ? `${baseLabel} · ${target.partyName}`
    : baseLabel;
  const reason = target.rejectionReasonI18n
    ? pickLocale(target.rejectionReasonI18n, locale)
    : t("reasonFallback");

  // Deadline chip (only when the requirement carries a correction_due_at).
  let deadlineLabel: string | null = null;
  if (target.correctionDueAt) {
    const d = new Date(target.correctionDueAt);
    const formatted = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
    }).format(d);
    deadlineLabel = t("deadlineLabel", { date: formatted });
  }

  const qs = new URLSearchParams();
  if (target.requirementId) qs.set("req", target.requirementId);
  if (target.partyId) qs.set("party", target.partyId);

  return (
    <CorregirScreen
      caseId={caseId}
      uploadQuery={qs.toString()}
      documentName={documentName}
      reviewerName={t("reviewerFallback")}
      reason={reason}
      deadlineLabel={deadlineLabel}
      labels={{
        back: t("back"),
        almostThere: t("almostThere"),
        justOneDetail: t("justOneDetail"),
        deadline: t("deadlineLabel"),
        whatToFix: t("whatToFix"),
        reviewerSuffix: t("reviewerSuffix"),
        okGuide: t("okGuide"),
        badGuide: t("badGuide"),
        uploadAgain: t("uploadAgain"),
        askTeam: t("askTeam"),
        empathy: t("empathy"),
      }}
    />
  );
}
