/**
 * Catalog module server actions — public API surface (module-pub boundary).
 *
 * Each action:
 * 1. Calls requireActor() to build the Actor.
 * 2. Delegates to service.ts (which calls can() as first line).
 * 3. Returns typed result or ActionError.
 *
 * API-IDs per DOC-48 §3.2.
 *
 * Note: "use server" directive belongs in Next.js action files under src/app/.
 * These functions are the service layer exposed as module-pub; Next.js wrappers
 * in src/app/ call these directly.
 */

import { requireActor } from "@/backend/platform/authz";
import { AuthzError } from "@/backend/platform/authz";
import { CatalogError } from "./domain";
import * as svc from "./service";

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

function fail(err: unknown): ActionResult<never> {
  if (err instanceof CatalogError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof AuthzError) {
    return { success: false, error: { code: err.reason, message: err.reason } };
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  return { success: false, error: { code: "INTERNAL_ERROR", message } };
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

/** @api-id API-CAT-08 */
export async function createServiceAction(
  input: Parameters<typeof svc.createService>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.createService>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.createService(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-09 */
export async function updateServiceAction(
  id: string,
  patch: Parameters<typeof svc.updateService>[2],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.updateService>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.updateService(actor, id, patch));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-10 */
export async function activateServiceAction(
  serviceId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof svc.activateService>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.activateService(actor, serviceId));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-11 */
export async function deactivateServiceAction(serviceId: string): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.deactivateService(actor, serviceId);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-12 */
export async function archiveServiceAction(serviceId: string): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.archiveService(actor, serviceId);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-13 */
export async function restoreServiceAction(serviceId: string): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.restoreService(actor, serviceId);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-15 */
export async function reorderServicesAction(
  orderedIds: string[],
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.reorderServices(actor, orderedIds);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/** @api-id API-CAT-16 */
export async function upsertServicePlanAction(
  input: Parameters<typeof svc.upsertServicePlan>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.upsertServicePlan>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.upsertServicePlan(actor, input));
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/** @api-id API-CAT-17 */
export async function createPhaseAction(
  input: Parameters<typeof svc.createPhase>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.createPhase>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.createPhase(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-18 */
export async function updatePhaseAction(
  id: string,
  patch: Parameters<typeof svc.updatePhase>[2],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.updatePhase>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.updatePhase(actor, id, patch));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-19 */
export async function deletePhaseAction(phaseId: string): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.deletePhase(actor, phaseId);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-20 */
export async function reorderPhasesAction(
  serviceId: string,
  orderedIds: string[],
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.reorderPhases(actor, serviceId, orderedIds);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Upserts the appointment policy of a phase (DOC-53 §4 step 3 — RF-ADM-026).
 * DOC-53 routes this through scheduling (API-SCH-13); in F1 the catalog owns the
 * phase policy table, so the action lives here over the existing service fn.
 *
 * @api-id API-SCH-13 (phase appointment policy — consolidated)
 */
export async function upsertPhasePolicyAction(
  input: Parameters<typeof svc.upsertPhasePolicy>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.upsertPhasePolicy>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.upsertPhasePolicy(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/**
 * Replaces the per-appointment schedule (cronograma) of a phase + its trailing
 * processing weeks. Each cita carries its own duration + week offset.
 *
 * @api-id API-CAT-34
 */
export async function upsertAppointmentScheduleAction(
  input: Parameters<typeof svc.upsertAppointmentSchedule>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.upsertAppointmentSchedule>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.upsertAppointmentSchedule(actor, input));
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

/** @api-id API-CAT-21 */
export async function createMilestoneAction(
  input: Parameters<typeof svc.createMilestone>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.createMilestone>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.createMilestone(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-22 */
export async function updateMilestoneAction(
  id: string,
  patch: Parameters<typeof svc.updateMilestone>[2],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.updateMilestone>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.updateMilestone(actor, id, patch));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-23 */
export async function deleteMilestoneAction(milestoneId: string): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.deleteMilestone(actor, milestoneId);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-24 — bulk reorder of a phase's milestones. */
export async function reorderMilestonesAction(
  servicePhaseId: string,
  orderedIds: string[],
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.reorderMilestones(actor, servicePhaseId, orderedIds);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-24 — full-list upsert of a phase's milestones. */
export async function upsertMilestonesAction(
  servicePhaseId: string,
  items: Parameters<typeof svc.upsertMilestones>[2],
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.upsertMilestones(actor, servicePhaseId, items);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Required documents
// ---------------------------------------------------------------------------

/** @api-id API-CAT-25 */
export async function createRequiredDocumentAction(
  input: Parameters<typeof svc.createRequiredDocument>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.createRequiredDocument>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.createRequiredDocument(actor, input));
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Service party roles (DOC-41 — admin catalog editor)
// ---------------------------------------------------------------------------

/** @api-id API-CAT-31 */
export async function createServicePartyRoleAction(
  input: Parameters<typeof svc.createServicePartyRole>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.createServicePartyRole>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.createServicePartyRole(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-32 */
export async function updateServicePartyRoleAction(
  id: string,
  patch: Parameters<typeof svc.updateServicePartyRole>[2],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.updateServicePartyRole>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.updateServicePartyRole(actor, id, patch));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-33 */
export async function deleteServicePartyRoleAction(
  id: string,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const actor = await requireActor();
    await svc.deleteServicePartyRole(actor, id);
    return ok({ ok: true } as const);
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-26 */
export async function updateRequiredDocumentAction(
  id: string,
  patch: Parameters<typeof svc.updateRequiredDocument>[2],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.updateRequiredDocument>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.updateRequiredDocument(actor, id, patch));
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Form definitions & pdf_automation cycle
// ---------------------------------------------------------------------------

/** @api-id API-CAT-29 */
export async function createFormDefinitionAction(
  input: Parameters<typeof svc.createFormDefinition>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.createFormDefinition>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.createFormDefinition(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-30 */
export async function updateFormDefinitionAction(
  id: string,
  patch: Parameters<typeof svc.updateFormDefinition>[2],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.updateFormDefinition>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.updateFormDefinition(actor, id, patch));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-35 */
export async function upsertQuestionGroupAction(
  input: Parameters<typeof svc.upsertQuestionGroup>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.upsertQuestionGroup>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.upsertQuestionGroup(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-36 */
export async function deleteQuestionGroupAction(groupId: string): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.deleteQuestionGroup(actor, groupId);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-38 */
export async function upsertQuestionAction(
  input: Parameters<typeof svc.upsertQuestion>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.upsertQuestion>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.upsertQuestion(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-39 */
export async function deleteQuestionAction(questionId: string): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.deleteQuestion(actor, questionId);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Paso 1 — upload-url for the official PDF (signed URL to catalog-assets).
 * @api-id API-CAT-07 (form_pdf)
 */
export async function createFormPdfUploadUrlAction(
  input: Parameters<typeof svc.createFormPdfUploadUrl>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.createFormPdfUploadUrl>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.createFormPdfUploadUrl(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-04 — signed download URL for the version PDF (editor viewer) */
export async function getVersionPdfUrlAction(
  versionId: string,
): Promise<ActionResult<string | null>> {
  try {
    const actor = await requireActor();
    return ok(await svc.getVersionPdfUrl(actor, versionId));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-32 — create version + chained detection */
export async function createAutomationVersionAction(
  input: Parameters<typeof svc.createAutomationVersion>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.createAutomationVersion>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.createAutomationVersion(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-33 — re-detect AcroForm fields */
export async function redetectFieldsAction(
  versionId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof svc.redetectFields>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.redetectFields(actor, versionId));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-34 — AI-assisted form segmentation */
export async function aiProposeStructureAction(
  input: Parameters<typeof svc.aiProposeStructure>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.aiProposeStructure>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.aiProposeStructure(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-42 — test PDF (in-memory). Returns base64 PDF + gaps. */
export async function generateTestPdfAction(
  input: Parameters<typeof svc.generateTestPdf>[1],
): Promise<ActionResult<{ pdfBase64: string; gaps: Array<{ question_id: string; pdf_field_name: string }> }>> {
  try {
    const actor = await requireActor();
    const r = await svc.generateTestPdf(actor, input);
    const pdfBase64 = Buffer.from(r.pdfBytes).toString("base64");
    return ok({ pdfBase64, gaps: r.gaps });
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-28 — propose extraction schema with AI */
export async function proposeExtractionSchemaAction(
  input: Parameters<typeof svc.proposeExtractionSchema>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.proposeExtractionSchema>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.proposeExtractionSchema(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-28b — validate an extraction_schema (live editor feedback) */
export async function validateExtractionSchemaAction(
  input: Parameters<typeof svc.checkExtractionSchema>[1],
): Promise<ActionResult<ReturnType<typeof svc.checkExtractionSchema>>> {
  try {
    const actor = await requireActor();
    return ok(svc.checkExtractionSchema(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-43 */
export async function publishVersionAction(
  input: Parameters<typeof svc.publishVersion>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.publishVersion>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.publishVersion(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-44 */
export async function unpublishVersionAction(versionId: string): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.unpublishVersion(actor, versionId);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-44 — duplicate an immutable version into an editable draft. */
export async function duplicateVersionAsDraftAction(
  versionId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof svc.duplicateVersionAsDraft>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.duplicateVersionAsDraft(actor, versionId));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-45 */
export async function setFormActiveAction(
  formDefinitionId: string,
  active: boolean,
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.setFormActive(actor, formDefinitionId, active);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// ai_letter lifecycle
// ---------------------------------------------------------------------------

/** @api-id API-CAT-46 */
export async function updateGenerationConfigAction(
  input: Parameters<typeof svc.updateGenerationConfig>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.updateGenerationConfig>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.updateGenerationConfig(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-47 — test generation (is_test=true) */
export async function testGenerationAction(
  input: Parameters<typeof svc.testGeneration>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.testGeneration>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.testGeneration(actor, input));
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

/** @api-id API-CAT-48 */
export async function createDatasetAction(
  input: Parameters<typeof svc.createDataset>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.createDataset>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.createDataset(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-49 */
export async function updateDatasetAction(
  id: string,
  patch: Parameters<typeof svc.updateDataset>[2],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.updateDataset>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.updateDataset(actor, id, patch));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-50 */
export async function createDatasetItemAction(
  input: Parameters<typeof svc.createDatasetItem>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.createDatasetItem>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.createDatasetItem(actor, input));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-51 */
export async function updateDatasetItemAction(
  itemId: string,
  patch: Parameters<typeof svc.updateDatasetItem>[2],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.updateDatasetItem>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.updateDatasetItem(actor, itemId, patch));
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-52 */
export async function deleteDatasetItemAction(itemId: string): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.deleteDatasetItem(actor, itemId);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-53 — delete dataset (FK-restricted; CATALOG_DATASET_IN_USE) */
export async function deleteDatasetAction(datasetId: string): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.deleteDataset(actor, datasetId);
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/** @api-id API-CAT-07 (dataset_file) — signed upload URL for a dataset file. */
export async function createDatasetFileUploadUrlAction(
  input: Parameters<typeof svc.createDatasetFileUploadUrl>[1],
): Promise<ActionResult<Awaited<ReturnType<typeof svc.createDatasetFileUploadUrl>>>> {
  try {
    const actor = await requireActor();
    return ok(await svc.createDatasetFileUploadUrl(actor, input));
  } catch (e) {
    return fail(e);
  }
}
