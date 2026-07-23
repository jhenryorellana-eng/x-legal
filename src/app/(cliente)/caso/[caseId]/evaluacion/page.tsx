/**
 * Evaluación (cliente) — `/caso/[caseId]/evaluacion` (external tool v1: Juez).
 *
 * Server component. Guards the actor, lazily creates the client's evaluation
 * session (getOrCreateClientEvaluation) and renders the embedded tool screen.
 * When the case's service has NO external tool, or the case is not active yet,
 * the module throws EvaluationsError (TOOL_NOT_ENABLED / CASE_NOT_ACTIVE) → 404.
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getOrCreateClientEvaluation } from "@/backend/modules/evaluations";
import type { Locale } from "@/frontend/features/cliente/shared/i18n";
import { EvaluacionScreen } from "@/frontend/features/cliente/evaluacion/evaluacion-screen";
import { refreshClientEvaluationAction, getClientEvaluationPdfUrlAction } from "./actions";

// The client's first visit lazily creates the session row — force dynamic.
export const dynamic = "force-dynamic";

export default async function EvaluacionPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.evaluacion");

  let vm;
  try {
    vm = await getOrCreateClientEvaluation(actor, caseId);
  } catch {
    // Tool not enabled / case not active (EvaluationsError), or an unknown/foreign
    // case → 404 (anti-enumeration), matching the case layout's defensive guard.
    notFound();
  }

  return (
    <EvaluacionScreen
      caseId={caseId}
      locale={locale}
      vm={vm}
      onRefresh={refreshClientEvaluationAction}
      onGetPdfUrl={getClientEvaluationPdfUrlAction}
      labels={{
        back: t("back"),
        title: t("title"),
        intro: t("intro"),
        attemptsRemaining: t.raw("attemptsRemaining") as string,
        uploadNotice: t("uploadNotice"),
        refresh: t("refresh"),
        generatingTitle: t("generatingTitle"),
        generatingBody: t("generatingBody"),
        readyTitle: t("readyTitle"),
        viewPdf: t("viewPdf"),
        nivelLabel: t("nivelLabel"),
        scoreLabel: t("scoreLabel"),
        errorTitle: t("errorTitle"),
        errorBody: t("errorBody"),
        noAttemptsTitle: t("noAttemptsTitle"),
        noAttemptsBody: t("noAttemptsBody"),
      }}
    />
  );
}
