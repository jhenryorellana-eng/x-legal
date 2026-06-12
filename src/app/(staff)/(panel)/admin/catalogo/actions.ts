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

export async function upsertPolicyUi(input: Record<string, unknown>): Promise<Res<unknown>> {
  const r = await upsertPhasePolicyAction(input as Parameters<typeof upsertPhasePolicyAction>[0]);
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export async function activateServiceUi(
  id: string,
): Promise<Res<{ ok: boolean; issues: Array<{ code: string; severity: "blocking" | "warning"; detail: string }> }>> {
  const r = await activateServiceAction(id);
  if (!r.success) return { success: false, error: r.error };
  const check = r.data as { ok: boolean; issues: Array<{ code: string; severity: "blocking" | "warning"; detail: string }> };
  return { success: true, data: { ok: check.ok, issues: check.issues } };
}
