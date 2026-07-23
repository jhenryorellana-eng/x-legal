"use server";

/**
 * Catalog server actions for the admin panel (DOC-53 §4).
 *
 * Thin "use server" wrappers over the catalog module-pub actions, normalized to
 * a `{ success, data?, error? }` envelope for the client wizard/list (DOC-21
 * R1/R2). The underlying actions already carry requireActor + can(catalog,edit).
 */

import {
  createServiceAction,
  updateServiceAction,
  activateServiceAction,
  deactivateServiceAction,
  archiveServiceAction,
  restoreServiceAction,
  upsertServicePlanAction,
  createPhaseAction,
  updatePhaseAction,
  deletePhaseAction,
  upsertPhasePolicyAction,
  upsertAppointmentScheduleAction,
  upsertMilestonesAction,
  createRequiredDocumentAction,
  updateRequiredDocumentAction,
  createServicePartyRoleAction,
  updateServicePartyRoleAction,
  deleteServicePartyRoleAction,
  upsertStageSlasAction,
  upsertDeadlinePolicyAction,
  upsertExternalToolAction,
  createFormDefinitionAction,
  updateFormDefinitionAction,
  proposeExtractionSchemaAction,
  validateExtractionSchemaAction,
  createTranslationSignatureUploadUrlAction,
  getTranslationSignatureUrlAction,
} from "@/backend/modules/catalog/actions";

type Res<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

export async function createServiceUi(input: Record<string, unknown>): Promise<Res<{ id: string }>> {
  const r = await createServiceAction(input as Parameters<typeof createServiceAction>[0]);
  return r.success ? { success: true, data: { id: (r.data as { id: string }).id } } : { success: false, error: r.error };
}

export async function updateServiceUi(id: string, patch: Record<string, unknown>): Promise<Res<unknown>> {
  const r = await updateServiceAction(id, patch as Parameters<typeof updateServiceAction>[1]);
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

/** Signed upload URL for a service's translation-signature image (PNG/JPG). */
export async function uploadTranslationSignatureUrlUi(
  serviceId: string,
  filename: string,
): Promise<Res<{ signedUrl: string; path: string }>> {
  const r = await createTranslationSignatureUploadUrlAction({ service_id: serviceId, filename });
  return r.success
    ? { success: true, data: r.data as { signedUrl: string; path: string } }
    : { success: false, error: r.error };
}

/** Signed download URL to preview a service's stored translation signature (or null). */
export async function signaturePreviewUrlUi(serviceId: string): Promise<Res<string | null>> {
  const r = await getTranslationSignatureUrlAction(serviceId);
  return r.success ? { success: true, data: r.data ?? null } : { success: false, error: r.error };
}

export async function setServiceActiveUi(id: string, active: boolean): Promise<Res<unknown>> {
  const r = active ? await activateServiceAction(id) : await deactivateServiceAction(id);
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export async function setServicePublicUi(id: string, isPublic: boolean): Promise<Res<unknown>> {
  const r = await updateServiceAction(id, { is_public: isPublic });
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export async function archiveServiceUi(id: string): Promise<Res<unknown>> {
  const r = await archiveServiceAction(id);
  return r.success ? { success: true } : { success: false, error: r.error };
}

export async function restoreServiceUi(id: string): Promise<Res<unknown>> {
  const r = await restoreServiceAction(id);
  return r.success ? { success: true } : { success: false, error: r.error };
}

export async function upsertPlanUi(input: Record<string, unknown>): Promise<Res<unknown>> {
  const r = await upsertServicePlanAction(input as Parameters<typeof upsertServicePlanAction>[0]);
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export async function createPhaseUi(input: Record<string, unknown>): Promise<Res<{ id: string }>> {
  const r = await createPhaseAction(input as Parameters<typeof createPhaseAction>[0]);
  return r.success ? { success: true, data: { id: (r.data as { id: string }).id } } : { success: false, error: r.error };
}

export async function updatePhaseUi(id: string, patch: Record<string, unknown>): Promise<Res<unknown>> {
  const r = await updatePhaseAction(id, patch as Parameters<typeof updatePhaseAction>[1]);
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export async function deletePhaseUi(id: string): Promise<Res<unknown>> {
  const r = await deletePhaseAction(id);
  return r.success ? { success: true } : { success: false, error: r.error };
}

export async function createRequiredDocUi(
  input: Record<string, unknown>,
): Promise<Res<{ id: string }>> {
  const r = await createRequiredDocumentAction(
    input as Parameters<typeof createRequiredDocumentAction>[0],
  );
  return r.success
    ? { success: true, data: { id: (r.data as { id: string }).id } }
    : { success: false, error: r.error };
}

export async function updateRequiredDocUi(
  id: string,
  patch: Record<string, unknown>,
): Promise<Res<{ id: string }>> {
  const r = await updateRequiredDocumentAction(
    id,
    patch as Parameters<typeof updateRequiredDocumentAction>[1],
  );
  return r.success
    ? { success: true, data: { id: (r.data as { id: string }).id } }
    : { success: false, error: r.error };
}

export async function upsertPolicyUi(input: Record<string, unknown>): Promise<Res<unknown>> {
  const r = await upsertPhasePolicyAction(input as Parameters<typeof upsertPhasePolicyAction>[0]);
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export async function upsertScheduleUi(input: Record<string, unknown>): Promise<Res<unknown>> {
  const r = await upsertAppointmentScheduleAction(
    input as Parameters<typeof upsertAppointmentScheduleAction>[0],
  );
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

/** Replaces the per-stage SLA (plazo de cuenta regresiva) of a service. */
export async function upsertStageSlasUi(input: Record<string, unknown>): Promise<Res<unknown>> {
  const r = await upsertStageSlasAction(
    input as Parameters<typeof upsertStageSlasAction>[0],
  );
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export async function upsertDeadlinePolicyUi(input: Record<string, unknown>): Promise<Res<unknown>> {
  const r = await upsertDeadlinePolicyAction(
    input as Parameters<typeof upsertDeadlinePolicyAction>[0],
  );
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

/** Crea/actualiza la herramienta externa (v1: Juez) de un servicio. */
export async function upsertExternalToolUi(input: Record<string, unknown>): Promise<Res<unknown>> {
  const r = await upsertExternalToolAction(
    input as Parameters<typeof upsertExternalToolAction>[0],
  );
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export async function upsertMilestonesUi(
  servicePhaseId: string,
  items: Array<Record<string, unknown>>,
): Promise<Res<unknown>> {
  const r = await upsertMilestonesAction(
    servicePhaseId,
    items as unknown as Parameters<typeof upsertMilestonesAction>[1],
  );
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export async function createServicePartyRoleUi(
  input: Record<string, unknown>,
): Promise<Res<{ id: string }>> {
  const r = await createServicePartyRoleAction(
    input as Parameters<typeof createServicePartyRoleAction>[0],
  );
  return r.success
    ? { success: true, data: { id: (r.data as { id: string }).id } }
    : { success: false, error: r.error };
}

export async function updateServicePartyRoleUi(
  id: string,
  patch: Record<string, unknown>,
): Promise<Res<unknown>> {
  const r = await updateServicePartyRoleAction(
    id,
    patch as Parameters<typeof updateServicePartyRoleAction>[1],
  );
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export async function deleteServicePartyRoleUi(id: string): Promise<Res<unknown>> {
  const r = await deleteServicePartyRoleAction(id);
  return r.success ? { success: true } : { success: false, error: r.error };
}

export async function createFormUi(
  input: Record<string, unknown>,
): Promise<Res<{ id: string }>> {
  // The cast is safe: createFormDefinition runs CreateFormDtoSchema.parse(input)
  // immediately, throwing on any malformed payload from the wizard.
  const r = await createFormDefinitionAction(
    input as Parameters<typeof createFormDefinitionAction>[0],
  );
  return r.success
    ? { success: true, data: { id: (r.data as { id: string }).id } }
    : { success: false, error: r.error };
}

export async function updateFormUi(
  id: string,
  patch: Record<string, unknown>,
): Promise<Res<unknown>> {
  const r = await updateFormDefinitionAction(
    id,
    patch as Parameters<typeof updateFormDefinitionAction>[1],
  );
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export async function proposeExtractionSchemaUi(input: {
  service_phase_id: string;
  label: string;
  help?: string;
}): Promise<Res<object>> {
  const r = await proposeExtractionSchemaAction(input);
  return r.success ? { success: true, data: r.data as object } : { success: false, error: r.error };
}

export async function validateExtractionSchemaUi(
  schema: unknown,
): Promise<Res<{ valid: boolean; reason?: string }>> {
  const r = await validateExtractionSchemaAction({ schema });
  return r.success
    ? { success: true, data: r.data as { valid: boolean; reason?: string } }
    : { success: false, error: r.error };
}

export async function activateServiceUi(
  id: string,
): Promise<Res<{ ok: boolean; issues: Array<{ code: string; severity: "blocking" | "warning"; detail: string }> }>> {
  const r = await activateServiceAction(id);
  if (!r.success) return { success: false, error: r.error };
  const check = r.data as { ok: boolean; issues: Array<{ code: string; severity: "blocking" | "warning"; detail: string }> };
  return { success: true, data: { ok: check.ok, issues: check.issues } };
}
