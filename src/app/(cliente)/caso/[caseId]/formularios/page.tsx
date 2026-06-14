/**
 * Formularios (list) — `/caso/[caseId]/formularios` · nivel CASO (pestaña
 * "Formularios") — DOC-51 §21 vista A.
 *
 * Server component. The "Formularios" CaseNav tab lands here. It resolves the
 * client-facing forms of the case's current phase via `getClientFormsForCase`:
 *  - 0 forms  → friendly empty.
 *  - 1 form   → straight into the wizard (or Mi Historia for a single ai_letter).
 *  - 2+ forms → the list (cards with status pill + per-party entries).
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getClientFormsForCase } from "@/backend/modules/cases";
import type { Locale } from "@/frontend/features/form-wizard";
import { pickI18n } from "@/frontend/features/form-wizard";
import { FormulariosList, type FormListEntry } from "@/frontend/features/cliente/formulario/formularios-list";
import { EmptyCase } from "@/frontend/features/cliente/shared/empty-case";

export default async function FormulariosListPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.formularios");

  let forms;
  try {
    forms = await getClientFormsForCase(actor, caseId);
  } catch {
    return <EmptyCase title={t("emptyTitle")} body={t("emptyBody")} lexMood="calma" />;
  }

  if (forms.length === 0) {
    return <EmptyCase title={t("emptyTitle")} body={t("emptyBody")} lexMood="calma" />;
  }

  // Single form → skip the list and go straight in.
  if (forms.length === 1) {
    const f = forms[0];
    if (f.kind === "ai_letter" && !f.partyId) {
      redirect(`/caso/${caseId}/historia`);
    }
    const qs = new URLSearchParams();
    if (f.partyId) qs.set("party", f.partyId);
    if (f.partyName) qs.set("name", `${pickI18n(f.labelI18n, locale)} — ${f.partyName}`);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    redirect(`/caso/${caseId}/formulario/${f.formDefinitionId}${suffix}`);
  }

  // 2+ forms → render the list with per-party labels.
  const entries: FormListEntry[] = forms.map((f) => {
    const base = pickI18n(f.labelI18n, locale);
    return {
      formDefinitionId: f.formDefinitionId,
      label: f.partyName ? `${base} — ${f.partyName}` : base,
      kind: f.kind,
      partyId: f.partyId,
      partyName: f.partyName,
      status: f.status,
    };
  });

  return (
    <FormulariosList
      caseId={caseId}
      entries={entries}
      labels={{
        eyebrow: t("eyebrow"),
        title: t("title"),
        subtitle: t("subtitle"),
        draft: t("draft"),
        submitted: t("submitted"),
        pending: t("pending"),
      }}
    />
  );
}
