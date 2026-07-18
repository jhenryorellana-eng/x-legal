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
import { saveDraftAction, submitFormAction, getAiPrefillAction } from "./actions";
import { translateAnswersAction } from "./translate-actions";
import { improveAnswerAction } from "./improve-actions";

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
      // Ola 2 gate: documents not 100% → locked state with CTA to Documentos.
      if (err.code === "FORMS_LOCKED_DOCS_INCOMPLETE") {
        return (
          <EmptyCase
            title={tEmpty("lockedTitle")}
            body={tEmpty("lockedBody")}
            lexMood="atento"
            action={{ href: `/caso/${caseId}/documentos`, label: tEmpty("lockedCta") }}
          />
        );
      }
      // FORM_NOT_FOUND / FORM_NOT_EDITABLE_BY_CLIENT → friendly empty.
      return <EmptyCase title={tEmpty("notFoundTitle")} body={tEmpty("notFoundBody")} lexMood="atento" />;
    }
    // Membership / unexpected → empty rather than a 500.
    return <EmptyCase title={tEmpty("notFoundTitle")} body={tEmpty("notFoundBody")} lexMood="atento" />;
  }

  // Ola 3 — per-case questionnaire states (before the generic no-version check,
  // since a ready dynamic questionnaire has groups but may have no versionId).
  if (dto.questionnaireGate === "generating") {
    return <EmptyCase title={tEmpty("qGeneratingTitle")} body={tEmpty("qGeneratingBody")} lexMood="calma" />;
  }
  if (dto.questionnaireGate === "failed") {
    return <EmptyCase title={tEmpty("qFailedTitle")} body={tEmpty("qFailedBody")} lexMood="atento" />;
  }
  if (dto.questionnaireGate === "pending_prereqs") {
    return (
      <EmptyCase
        title={tEmpty("qPendingTitle")}
        body={tEmpty("qPendingBody")}
        lexMood="atento"
        action={{ href: `/caso/${caseId}/formularios`, label: tEmpty("qPendingCta") }}
      />
    );
  }

  // No published version / no groups → the form has no questions yet to answer.
  if (dto.groups.length === 0) {
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
      getAiPrefill={getAiPrefillAction}
      translateAnswers={translateAnswersAction}
      improveAnswer={improveAnswerAction}
      exitHref={`/caso/${caseId}/camino`}
    />
  );
}
