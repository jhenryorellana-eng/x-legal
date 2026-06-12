"use server";

/**
 * Employee management server actions for the admin panel (DOC-53 §7).
 *
 * Thin wrappers over the identity module-pub actions, adapting their typed
 * results to the simple `{ ok, error? }` shape the client view expects. The
 * identity actions already carry "use server" + requireActor + can(); these
 * just normalize the result envelope so the feature component stays presentational.
 */

import {
  inviteEmployeeAction,
  updateEmployeePermissionsAction,
  deactivateEmployeeAction,
  reactivateEmployeeAction,
} from "@/backend/modules/identity/actions";

type Result = { ok: boolean; error?: { code: string; message: string } };

export async function inviteEmployeeUi(input: {
  email: string;
  displayName: string;
  titleI18n: Record<string, string> | null;
  role: "sales" | "paralegal" | "finance";
  permissionsPreset: Array<{ module_key: string; can_view: boolean; can_edit: boolean }>;
}): Promise<Result> {
  const r = await inviteEmployeeAction(input);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function updatePermissionsUi(input: {
  staffId: string;
  permissions: Array<{ module_key: string; can_view: boolean; can_edit: boolean }>;
}): Promise<Result> {
  const r = await updateEmployeePermissionsAction(input);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function setEmployeeActiveUi(staffId: string, active: boolean): Promise<Result> {
  const r = active
    ? await reactivateEmployeeAction(staffId)
    : await deactivateEmployeeAction(staffId);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
