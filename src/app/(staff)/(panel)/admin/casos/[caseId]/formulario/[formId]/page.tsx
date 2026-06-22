/**
 * Staff form fill (admin) — `/admin/casos/[caseId]/formulario/[formId]` (RF-ADM-010).
 *
 * Mounts the SAME FormWizard the client uses, but for a staff actor: reads the
 * form via getFormForClient (staff allowed by case access) and injects the staff
 * save/submit/translate actions. onSubmitted/onExit return to the case workspace.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getFormForClient, CaseError } from "@/backend/modules/cases";
import { type WizardForm, type Locale, resolveWizardLabels } from "@/frontend/features/form-wizard";
import { StaffFormScreen } from "@/frontend/features/shared-case/staff-form-screen";
import {
  saveFormDraftAction,
  submitFormResponseAction,
  translateFormAnswersAction,
} from "@/app/(staff)/(panel)/admin/casos/actions";

export const dynamic = "force-dynamic";

export default async function AdminCaseFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string; formId: string }>;
  searchParams: Promise<{ party?: string; name?: string }>;
}) {
  const { caseId, formId } = await params;
  const { party, name } = await searchParams;
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const back = `/admin/casos/${caseId}`;
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.formWizard");
  const partyId = party ?? null;

  let dto;
  try {
    dto = await getFormForClient(actor, { caseId, formDefinitionId: formId, partyId });
  } catch (err) {
    if (err instanceof CaseError) redirect(back);
    throw err;
  }
  if (!dto.versionId || dto.groups.length === 0) redirect(back);

  const form = dto as WizardForm;
  const labels = resolveWizardLabels(t as unknown as (key: string) => string);

  return (
    <StaffFormScreen
      caseId={caseId}
      partyId={partyId}
      partyName={name ?? null}
      form={form}
      locale={locale}
      labels={labels}
      saveDraft={saveFormDraftAction}
      submitForm={submitFormResponseAction}
      translateAnswers={translateFormAnswersAction}
      backHref={back}
    />
  );
}
