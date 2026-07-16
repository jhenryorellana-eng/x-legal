/**
 * Mi Historia — `/caso/[caseId]/historia` · nivel CASO (pestaña "Formularios")
 * — DOC-51 §20.
 *
 * Server component. Resolves the case's `ai_letter` ("Mi Historia") form for the
 * current phase, reads it (+ saved draft) via `getFormForClient`, and mounts the
 * shared FormWizard with Lex "atento", a listening chip and per-textarea voice
 * dictation. Same engine as the generic wizard (chasis idéntico).
 *
 * If the phase has no Mi Historia form yet → friendly placeholder (never a 500).
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getClientFormsForCase, getFormForClient, CaseError } from "@/backend/modules/cases";
import type { WizardForm, Locale } from "@/frontend/features/form-wizard";
import { resolveWizardLabels } from "@/frontend/features/form-wizard";
import { HistoriaScreen } from "@/frontend/features/cliente/historia/historia-screen";
import { EmptyCase } from "@/frontend/features/cliente/shared/empty-case";
import { saveDraftAction, submitFormAction } from "./actions";
import { improveAnswerAction } from "../formulario/[formId]/improve-actions";

export default async function HistoriaPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ party?: string; name?: string }>;
}) {
  const { caseId } = await params;
  const { party, name } = await searchParams;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.formWizard");
  const tHist = await getTranslations("cliente.historia");
  const tEmpty = await getTranslations("cliente.formularios");

  // Resolve the Mi Historia (ai_letter) form for the current phase.
  let storyFormId = "";
  let partyId: string | null = party ?? null;
  let partyName: string | null = name ?? null;
  try {
    const forms = await getClientFormsForCase(actor, caseId);
    const story = party
      ? forms.find((f) => f.kind === "ai_letter" && f.partyId === party)
      : forms.find((f) => f.kind === "ai_letter");
    if (story) {
      // The client answers the companion questionnaire (the questions that feed
      // the AI); the ai_letter itself carries no fillable questions.
      storyFormId = story.fillFormDefinitionId;
      partyId = story.partyId;
      partyName = story.partyName ?? partyName;
    }
  } catch {
    // membership / unexpected → fall through to placeholder
  }

  if (!storyFormId) {
    return <EmptyCase title={tHist("placeholderTitle")} body={tHist("placeholderBody")} lexMood="atento" />;
  }

  let dto;
  try {
    dto = await getFormForClient(actor, { caseId, formDefinitionId: storyFormId, partyId });
  } catch (err) {
    if (err instanceof CaseError && err.code === "FORMS_LOCKED_DOCS_INCOMPLETE") {
      return (
        <EmptyCase
          title={tEmpty("lockedTitle")}
          body={tEmpty("lockedBody")}
          lexMood="atento"
          action={{ href: `/caso/${caseId}/documentos`, label: tEmpty("lockedCta") }}
        />
      );
    }
    if (err instanceof CaseError) {
      return <EmptyCase title={tHist("placeholderTitle")} body={tHist("placeholderBody")} lexMood="atento" />;
    }
    return <EmptyCase title={tHist("placeholderTitle")} body={tHist("placeholderBody")} lexMood="atento" />;
  }

  // Ola 3 — per-case questionnaire gates (mirror /formulario/[formId]/page.tsx).
  // The Memorándum's fill target is a dynamic (hybrid) questionnaire; block entry
  // until it's generated / its prerequisites (e.g. the submitted I-589) are met,
  // instead of silently showing the base questions early.
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

  if (!dto.versionId || dto.groups.length === 0) {
    return <EmptyCase title={tHist("placeholderTitle")} body={tHist("placeholderBody")} lexMood="calma" />;
  }

  const form = dto as WizardForm;
  const labels = resolveWizardLabels(t as unknown as (key: string) => string);

  return (
    <HistoriaScreen
      caseId={caseId}
      partyId={partyId}
      partyName={partyName}
      form={form}
      locale={locale}
      labels={labels}
      lexChip={tHist("listeningChip")}
      saveDraft={saveDraftAction}
      submitForm={submitFormAction}
      improveAnswer={improveAnswerAction}
    />
  );
}
