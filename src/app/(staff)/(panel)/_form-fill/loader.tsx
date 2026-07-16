/**
 * Shared staff form-fill loader — the "Ver" screen reached from the case's
 * Información tab (RF-ADM-010 / RF-VAN-043). Mounts the SAME FormWizard the client
 * uses: with edit rights the staff fills/corrects the client's answers and can
 * complete + submit on their behalf (durable autosave identical to the client);
 * without them it stays read-only ("Ver"). One place for the data + action wiring —
 * each route (admin / legal / ventas) is a thin wrapper that supplies its `backHref`.
 *
 * `_form-fill` is a Next.js private folder (underscore) — colocation only, never a
 * route. Boundary R1/R2: app → module-pub (cases/identity) + frontend + app actions.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getFormForClient, CaseError } from "@/backend/modules/cases";
import { type WizardForm, type Locale, resolveWizardLabels } from "@/frontend/features/form-wizard";
import { StaffFormScreen } from "@/frontend/features/shared-case/staff-form-screen";
import { resolveStaffFormEditability } from "@/app/(staff)/(panel)/_case-forms/editability";
import {
  submitFormResponseAction,
  translateFormAnswersAction,
  improveFormAnswerAction,
} from "@/app/(staff)/(panel)/admin/casos/actions";

export async function StaffFormFillLoader({
  caseId,
  formId,
  party,
  name,
  backHref,
}: {
  caseId: string;
  formId: string;
  party?: string;
  name?: string;
  /** Where "back"/"submitted" lands — the case's Formularios/Información tab. */
  backHref: string;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.formWizard");
  const partyId = party ?? null;

  let dto;
  try {
    dto = await getFormForClient(actor, { caseId, formDefinitionId: formId, partyId });
  } catch (err) {
    if (err instanceof CaseError) redirect(backHref);
    throw err;
  }
  if (!dto.versionId || dto.groups.length === 0) redirect(backHref);

  const form = dto as WizardForm;
  const labels = resolveWizardLabels(t as unknown as (key: string) => string);
  const { editable, saveDraft } = resolveStaffFormEditability(actor, form);

  return (
    <StaffFormScreen
      caseId={caseId}
      partyId={partyId}
      partyName={name ?? null}
      form={form}
      locale={locale}
      labels={labels}
      editable={editable}
      allowStaffSubmit
      saveDraft={saveDraft}
      submitForm={submitFormResponseAction}
      translateAnswers={translateFormAnswersAction}
      improveAnswer={improveFormAnswerAction}
      backHref={backHref}
    />
  );
}
