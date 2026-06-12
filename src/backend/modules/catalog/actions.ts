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
