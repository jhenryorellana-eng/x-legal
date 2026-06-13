/**
 * ¡Lo lograste! — `/caso/[caseId]/exito?progress&gain` · NO_CHROME — DOC-51 §16.
 *
 * Server component. The progress + gain come from the upload confirmation (real
 * backend numbers, passed as query params); the name is the client's first name.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getClientDisplayName } from "@/backend/modules/cases";
import { ExitoScreen } from "@/frontend/features/cliente/documentos/exito-screen";

export default async function ExitoPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ progress?: string; gain?: string }>;
}) {
  const { caseId } = await params;
  const { progress, gain } = await searchParams;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const t = await getTranslations("cliente.exito");
  const displayName = (await getClientDisplayName(actor)) ?? t("fallbackName");

  return (
    <ExitoScreen
      caseId={caseId}
      displayName={displayName}
      progress={Math.max(0, Math.min(100, Number(progress) || 0))}
      gain={Math.max(0, Number(gain) || 0)}
      labels={{
        title: t("title"),
        body: t("body"),
        phaseProgress: t("phaseProgress"),
        continue: t("continue"),
      }}
    />
  );
}
