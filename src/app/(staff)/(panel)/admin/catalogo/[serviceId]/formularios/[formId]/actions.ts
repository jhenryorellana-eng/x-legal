"use server";

/**
 * Form editor server actions (DOC-53 §5).
 *
 * Thin "use server" wrappers over the catalog module-pub actions, normalized to
 * the `{ success, data?, error? }` envelope the editor client consumes. The
 * underlying actions already carry requireActor + can(catalog, edit). The app
 * boundary never imports platform/* — signed uploads live in the catalog module
 * (createFormPdfUploadUrl), wrapped here.
 */

import {
  createFormPdfUploadUrlAction,
  getVersionPdfUrlAction,
  createAutomationVersionAction,
  redetectFieldsAction,
  aiProposeStructureAction,
  ensureCompanionQuestionnaireAction,
  upsertQuestionGroupAction,
  deleteQuestionGroupAction,
  upsertQuestionAction,
  updateQuestionAiImproveAction,
  deleteQuestionAction,
  generateTestPdfAction,
  publishVersionAction,
  unpublishVersionAction,
  duplicateVersionAsDraftAction,
  updateVersionEmptyPolicyAction,
  updateGenerationConfigAction,
  updateQuestionnaireGenerationConfigAction,
  saveFormFillGuideAction,
  testGenerationAction,
} from "@/backend/modules/catalog/actions";

type Res<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

function envelope<T>(r: { success: boolean; data?: T; error?: { code: string; message: string } }): Res<T> {
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

// --- Stage 1: Upload PDF ---------------------------------------------------

export async function createFormPdfUploadUrlUi(input: {
  form_definition_id: string;
  filename: string;
}): Promise<Res<{ signedUrl: string; path: string }>> {
  return envelope(await createFormPdfUploadUrlAction(input));
}

export async function createAutomationVersionUi(input: {
  form_definition_id: string;
  uploaded_pdf_path: string;
  source_language?: "en" | "es";
}): Promise<Res<unknown>> {
  return envelope(await createAutomationVersionAction(input));
}

export async function redetectFieldsUi(versionId: string): Promise<Res<unknown>> {
  return envelope(await redetectFieldsAction(versionId));
}

export async function getVersionPdfUrlUi(versionId: string): Promise<Res<string | null>> {
  return envelope(await getVersionPdfUrlAction(versionId));
}

// --- Stage 2: Structure ----------------------------------------------------

export async function aiProposeStructureUi(input: {
  version_id: string;
  group_id?: string;
  mode: "replace" | "merge";
  pageRange?: { from: number; to: number };
}): Promise<Res<{ groups: number; questions: number }>> {
  return envelope(await aiProposeStructureAction(input));
}

export async function ensureCompanionQuestionnaireUi(
  aiLetterFormId: string,
): Promise<Res<{ id: string; slug: string; created: boolean }>> {
  return envelope(await ensureCompanionQuestionnaireAction(aiLetterFormId));
}

export async function upsertGroupUi(input: {
  id?: string;
  automation_version_id: string;
  title_i18n?: Record<string, string>;
  position?: number;
  do_not_fill?: boolean;
}): Promise<Res<{ id: string }>> {
  const r = await upsertQuestionGroupAction(input);
  return r.success
    ? { success: true, data: { id: (r.data as { id: string }).id } }
    : { success: false, error: r.error };
}

export async function deleteGroupUi(groupId: string): Promise<Res<unknown>> {
  return envelope(await deleteQuestionGroupAction(groupId));
}

export async function upsertQuestionUi(input: Record<string, unknown>): Promise<Res<{ id: string }>> {
  const r = await upsertQuestionAction(input);
  return r.success
    ? { success: true, data: { id: (r.data as { id: string }).id } }
    : { success: false, error: r.error };
}

export async function deleteQuestionUi(questionId: string): Promise<Res<unknown>> {
  return envelope(await deleteQuestionAction(questionId));
}

/** "Mejorar con IA" — dedicated path; also editable on PUBLISHED versions. */
export async function updateQuestionAiImproveUi(input: {
  question_id: string;
  ai_improve: { instruction: string } | null;
}): Promise<Res<unknown>> {
  return envelope(await updateQuestionAiImproveAction(input));
}

// --- Stage 3: Preview ------------------------------------------------------

export async function generateTestPdfUi(input: {
  version_id: string;
  sample_answers: Record<string, unknown>;
}): Promise<Res<{ pdfBase64: string; gaps: Array<{ question_id: string; pdf_field_name: string }> }>> {
  return envelope(await generateTestPdfAction(input));
}

// --- Stage 4: Publish ------------------------------------------------------

export async function publishVersionUi(input: {
  version_id: string;
  acknowledge_unmapped?: boolean;
}): Promise<Res<{ ok: boolean; issues: Array<{ code: string; severity: "blocking" | "warning"; detail: string }> }>> {
  const r = await publishVersionAction(input);
  if (!r.success) return { success: false, error: r.error };
  const check = r.data as { ok: boolean; issues: Array<{ code: string; severity: "blocking" | "warning"; detail: string }> };
  return { success: true, data: { ok: check.ok, issues: check.issues } };
}

export async function unpublishVersionUi(versionId: string): Promise<Res<unknown>> {
  return envelope(await unpublishVersionAction(versionId));
}

export async function duplicateVersionUi(versionId: string): Promise<Res<{ id: string }>> {
  return envelope(await duplicateVersionAsDraftAction(versionId)) as Res<{ id: string }>;
}

export async function setVersionEmptyPolicyUi(input: {
  version_id: string;
  default_empty_policy: "auto" | "na" | "blank";
}): Promise<Res<unknown>> {
  return envelope(await updateVersionEmptyPolicyAction(input));
}

// --- ai_letter mode --------------------------------------------------------

export async function updateGenerationConfigUi(
  input: Record<string, unknown>,
): Promise<Res<unknown>> {
  return envelope(
    await updateGenerationConfigAction(
      input as Parameters<typeof updateGenerationConfigAction>[0],
    ),
  );
}

export async function testGenerationUi(input: {
  form_definition_id: string;
  case_id: string;
  party_id?: string;
}): Promise<Res<{ run_id: string }>> {
  return envelope(await testGenerationAction(input));
}

// --- questionnaire (Ola 3) per-case generation config ----------------------

export async function saveQuestionnaireGenConfigUi(
  input: Record<string, unknown>,
): Promise<Res<unknown>> {
  return envelope(
    await updateQuestionnaireGenerationConfigAction(
      input as Parameters<typeof updateQuestionnaireGenerationConfigAction>[0],
    ),
  );
}

// --- Pre-Mortem validation guide (both kinds) ------------------------------

export async function savePreMortemGuideUi(input: {
  form_definition_id: string;
  enabled: boolean;
  guide_markdown: string;
  source_file_path?: string | null;
}): Promise<Res<unknown>> {
  return envelope(await saveFormFillGuideAction(input));
}
