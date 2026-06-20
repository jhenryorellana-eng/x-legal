/**
 * Mis Documentos — `/caso/[caseId]/documentos` · nivel CASO — DOC-51 §14.
 *
 * Server component. Reads the documents matrix (cases module: requirements of the
 * current phase expanded per party, joined with case_documents → visible status).
 * Groups by category; per-party requirements carry the party name in the label.
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getDocumentsMatrix } from "@/backend/modules/cases";
import { pickLocale, type Locale } from "@/frontend/features/cliente/shared/i18n";
import {
  DocumentosScreen,
  type DocItem,
} from "@/frontend/features/cliente/documentos/documentos-screen";
import { EmptyCase } from "@/frontend/features/cliente/shared/empty-case";

export default async function DocumentosPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.documentos");

  let matrix;
  try {
    matrix = await getDocumentsMatrix(actor, caseId);
  } catch {
    notFound();
  }

  const phaseName = pickLocale(matrix.phaseLabelI18n, locale);
  const uncategorized = t("uncategorized");

  if (matrix.items.length === 0) {
    return (
      <EmptyCase
        title={t("emptyTitle")}
        body={t("emptyBody")}
        lexMood="calma"
      />
    );
  }

  const items: DocItem[] = matrix.items.map((d) => {
    const baseLabel = pickLocale(d.labelI18n, locale);
    const label = d.partyName ? `${baseLabel} · ${d.partyName}` : baseLabel;
    const category = pickLocale(d.categoryI18n, locale) || uncategorized;
    const qs = new URLSearchParams();
    if (d.requirementId) qs.set("req", d.requirementId);
    if (d.partyId) qs.set("party", d.partyId);
    if (d.documentId) qs.set("doc", d.documentId);
    return {
      key: d.key,
      label,
      category,
      status: d.status,
      rejectionReason: d.rejectionReasonI18n
        ? pickLocale(d.rejectionReasonI18n, locale)
        : null,
      query: qs.toString(),
    };
  });

  return (
    <DocumentosScreen
      items={items}
      done={matrix.done}
      total={matrix.total}
      progress={matrix.progress}
      phaseName={phaseName}
      caseId={caseId}
      labels={{
        title: t("title"),
        // "{phase}" placeholder is filled by the screen — t.raw keeps the template
        // (t() would fail to format the missing var and render the raw key).
        subtitle: t.raw("subtitle") as string,
        ofWord: t("of"),
        completed: t("completed"),
        tip: t("tip"),
        approved: t("approved"),
        inReview: t("inReview"),
        upload: t("upload"),
        fix: t("fix"),
      }}
    />
  );
}
