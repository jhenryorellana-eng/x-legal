/**
 * Form editor — /admin/catalogo/[serviceId]/formularios/[formId] (DOC-53 §5).
 *
 * The most complex screen of the admin panel. Server Component: guards the actor,
 * reads the full editor data (form + versions + open version tree + sources +
 * generation config) via the catalog module-pub read, maps it into the editor
 * VM, and renders the editor client with the app server actions injected.
 */

import { notFound, redirect } from "next/navigation";
import { getActor } from "@/backend/modules/identity";
import { getFormEditorData, listDatasetsAdmin } from "@/backend/modules/catalog";
import {
  FormEditorView,
  buildFormEditorVM,
  FORM_EDITOR_STRINGS_ES,
  type FormEditorActions,
} from "@/frontend/features/admin/form-editor";
import type { RawFormEditorData, RawDataset } from "@/frontend/features/admin/form-editor/build-vm";
import {
  createFormPdfUploadUrlUi,
  getVersionPdfUrlUi,
  createAutomationVersionUi,
  redetectFieldsUi,
  aiProposeStructureUi,
  upsertGroupUi,
  deleteGroupUi,
  upsertQuestionUi,
  deleteQuestionUi,
  generateTestPdfUi,
  publishVersionUi,
  unpublishVersionUi,
  duplicateVersionUi,
  updateGenerationConfigUi,
  testGenerationUi,
} from "./actions";

export default async function FormEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceId: string; formId: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const { serviceId, formId } = await params;
  const { v } = await searchParams;

  const data = await getFormEditorData(actor, formId, v);
  if (!data || data.service.id !== serviceId) notFound();

  const datasets = await listDatasetsAdmin(actor);

  const vm = buildFormEditorVM(
    data as unknown as RawFormEditorData,
    datasets.map((d) => ({ id: d.id, name: d.name, total_tokens: d.total_tokens, is_active: d.is_active })) as RawDataset[],
  );

  const actions: FormEditorActions = {
    createUploadUrl: createFormPdfUploadUrlUi,
    createVersion: createAutomationVersionUi,
    redetect: redetectFieldsUi,
    getPdfUrl: getVersionPdfUrlUi,
    aiPropose: aiProposeStructureUi,
    upsertGroup: upsertGroupUi,
    deleteGroup: deleteGroupUi,
    upsertQuestion: upsertQuestionUi,
    deleteQuestion: deleteQuestionUi,
    generateTestPdf: generateTestPdfUi,
    publish: publishVersionUi,
    unpublish: unpublishVersionUi,
    duplicateVersion: duplicateVersionUi,
    saveGenerationConfig: updateGenerationConfigUi,
    testGeneration: testGenerationUi,
  };

  return (
    <FormEditorView
      vm={vm}
      strings={FORM_EDITOR_STRINGS_ES}
      actions={actions}
      lang="es"
      datasetsHref="/admin/datasets"
    />
  );
}
