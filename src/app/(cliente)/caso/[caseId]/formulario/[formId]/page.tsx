/**
 * Formularios — `/caso/[caseId]/formulario/[formId]` · nivel CASO (pestaña
 * "Formularios") — DOC-51 §21.
 *
 * Server component. Reads the published form (+ resolved prefills + saved draft)
 * via `getFormForClient` (cases module-pub, R2) and mounts the shared FormWizard
 * with the autosave/submit actions injected as props (DOC-50 §2/§6).
 *
 * States:
 *  - blocked-by-version / no published version → friendly "sin disponibilidad".
 *  - completed (submitted/approved) → the wizard renders its read-only branch.
 *  - not editable by client / not found → friendly empty (never a 500).
 *
 * The optional `?party=<uuid>` selects the per-party response (DOC-51 §21).
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getFormForClient, CaseError } from "@/backend/modules/cases";
import type {
  WizardForm,
  Locale,
} from "@/frontend/features/form-wizard";
import { resolveWizardLabels } from "@/frontend/features/form-wizard";
import { FormularioScreen } from "@/frontend/features/cliente/formulario/formulario-screen";
import { EmptyCase } from "@/frontend/features/cliente/shared/empty-case";
import { saveDraftAction, submitFormAction } from "./actions";

export default async function FormularioPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string; formId: string }>;
  searchParams: Promise<{ party?: string; name?: string }>;
}) {
  const { caseId, formId } = await params;
  const { party, name } = await searchParams;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.formWizard");
  const tEmpty = await getTranslations("cliente.formularios");

  const partyId = party ?? null;

  let dto;
  try {
    dto = await getFormForClient(actor, {
      caseId,
      formDefinitionId: formId,
      partyId,
    });
  } catch (err) {
    if (err instanceof CaseError) {
      // FORM_NOT_FOUND / FORM_NOT_EDITABLE_BY_CLIENT → friendly empty.
      return <EmptyCase title={tEmpty("notFoundTitle")} body={tEmpty("notFoundBody")} lexMood="atento" />;
    }
    // Membership / unexpected → empty rather than a 500.
    return <EmptyCase title={tEmpty("notFoundTitle")} body={tEmpty("notFoundBody")} lexMood="atento" />;
  }

  // No published version / no groups → the form has no questions yet to answer.
  if (!dto.versionId || dto.groups.length === 0) {
    return <EmptyCase title={tEmpty("noVersionTitle")} body={tEmpty("noVersionBody")} lexMood="calma" />;
  }

  // The DTO is structurally a WizardForm.
  const form = dto as WizardForm;

  // labels bundle (cast translator to the loose signature the resolver expects)
  const labels = resolveWizardLabels(t as unknown as (key: string) => string);

  return (
    <FormularioScreen
      caseId={caseId}
      partyId={partyId}
      partyName={name ?? null}
      form={form}
      locale={locale}
      labels={labels}
      saveDraft={saveDraftAction}
      submitForm={submitFormAction}
      exitHref={`/caso/${caseId}/camino`}
    />
  );
}
