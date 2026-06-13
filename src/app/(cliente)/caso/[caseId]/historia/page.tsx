/**
 * Mi Historia — `/caso/[caseId]/historia` · nivel CASO (pestaña "Formularios").
 *
 * F2 scope: ONLY the navigation entry (the full dictation wizard lands in F4,
 * DOC-51 §20). We render a faithful placeholder so the "Formularios" tab and the
 * Camino "Cuéntanos tu historia" CTA resolve without a 500. The membership guard
 * lives in the case layout.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { EmptyCase } from "@/frontend/features/cliente/shared/empty-case";

export default async function HistoriaPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const t = await getTranslations("cliente.historia");

  return <EmptyCase title={t("placeholderTitle")} body={t("placeholderBody")} lexMood="atento" />;
}
