"use server";

/**
 * Datasets server actions (DOC-53 §6). Thin "use server" wrappers over the
 * catalog module-pub dataset actions, normalized to the `{ success, data?,
 * error? }` envelope. The underlying actions carry requireActor + can(datasets,
 * edit). Uploads (createDatasetFileUploadUrl) live in the catalog module — app
 * never imports platform/storage.
 */

import {
  createDatasetAction,
  updateDatasetAction,
  deleteDatasetAction,
  createDatasetItemAction,
  updateDatasetItemAction,
  deleteDatasetItemAction,
  createDatasetFileUploadUrlAction,
} from "@/backend/modules/catalog/actions";

type Res<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

function envelope<T>(r: { success: boolean; data?: T; error?: { code: string; message: string } }): Res<T> {
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

export async function createDatasetUi(input: {
  name: string;
  purpose?: string;
  source_kind?: string;
}): Promise<Res<{ id: string }>> {
  const r = await createDatasetAction(input);
  return r.success
    ? { success: true, data: { id: (r.data as { id: string }).id } }
    : { success: false, error: r.error };
}

export async function updateDatasetUi(
  id: string,
  patch: { name?: string; purpose?: string; source_kind?: string; is_active?: boolean },
): Promise<Res<unknown>> {
  return envelope(await updateDatasetAction(id, patch));
}

export async function deleteDatasetUi(id: string): Promise<Res<unknown>> {
  return envelope(await deleteDatasetAction(id));
}

/**
 * Toggle a dataset's active flag. A dedicated "use server" action so the page
 * can pass it DIRECTLY to the client view — wrapping updateDatasetUi in an inline
 * arrow in the page would make the wrapper a non-server function (RSC boundary error).
 */
export async function setDatasetActiveUi(id: string, isActive: boolean): Promise<Res<unknown>> {
  return updateDatasetUi(id, { is_active: isActive });
}

export async function createDatasetItemUi(input: {
  dataset_id: string;
  title: string;
  content?: string | null;
  file_path?: string | null;
  jurisdiction?: string | null;
  outcome?: string | null;
  tags?: string[];
}): Promise<Res<{ id: string; token_count: number | null }>> {
  const r = await createDatasetItemAction(input);
  return r.success
    ? { success: true, data: { id: (r.data as { id: string }).id, token_count: (r.data as { token_count: number | null }).token_count } }
    : { success: false, error: r.error };
}

export async function updateDatasetItemUi(
  itemId: string,
  patch: {
    title?: string;
    content?: string | null;
    file_path?: string | null;
    jurisdiction?: string | null;
    outcome?: string | null;
    tags?: string[];
  },
): Promise<Res<{ token_count: number | null }>> {
  const r = await updateDatasetItemAction(itemId, patch);
  return r.success
    ? { success: true, data: { token_count: (r.data as { token_count: number | null }).token_count } }
    : { success: false, error: r.error };
}

export async function deleteDatasetItemUi(itemId: string): Promise<Res<unknown>> {
  return envelope(await deleteDatasetItemAction(itemId));
}

export async function createDatasetFileUploadUrlUi(input: {
  dataset_id: string;
  filename: string;
}): Promise<Res<{ signedUrl: string; path: string }>> {
  return envelope(await createDatasetFileUploadUrlAction(input));
}
