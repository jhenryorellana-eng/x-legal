"use server";

/**
 * demo-assets — server actions (module-pub border).
 *
 * Injected into the `/admin/demo` index UI ("⋯ → Data" modal). Everything is
 * admin-only (service-enforced). The storage path never crosses the border:
 * clients only ever see the signed URL. @module demo-assets/actions
 */

import { requireActor, AuthzError } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import { DemoAssetsError } from "./domain";
import {
  confirmDemoAssetUpload,
  createDemoAssetUploadUrl,
  deleteDemoAsset,
  listDemoAssetStatus,
  type DemoAssetSlotStatus,
} from "./service";

export type DemoAssetActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string } };

function errorCode(err: unknown): string {
  if (err instanceof AuthzError) return err.reason;
  if (err instanceof DemoAssetsError) return err.code;
  return "error";
}

export async function listDemoAssetStatusAction(input: {
  slug: string;
}): Promise<DemoAssetActionResult<DemoAssetSlotStatus[]>> {
  try {
    const actor = await requireActor();
    return { ok: true, data: await listDemoAssetStatus(actor, input.slug) };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "listDemoAssetStatusAction failed");
    return { ok: false, error: { code: errorCode(err) } };
  }
}

export async function startDemoAssetUploadAction(input: {
  slug: string;
  slotKey: string;
}): Promise<DemoAssetActionResult<{ signedUrl: string }>> {
  try {
    const actor = await requireActor();
    const { signedUrl } = await createDemoAssetUploadUrl(actor, input);
    return { ok: true, data: { signedUrl } };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "startDemoAssetUploadAction failed");
    return { ok: false, error: { code: errorCode(err) } };
  }
}

export async function confirmDemoAssetUploadAction(input: {
  slug: string;
  slotKey: string;
}): Promise<DemoAssetActionResult<DemoAssetSlotStatus>> {
  try {
    const actor = await requireActor();
    return { ok: true, data: await confirmDemoAssetUpload(actor, input) };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "confirmDemoAssetUploadAction failed");
    return { ok: false, error: { code: errorCode(err) } };
  }
}

export async function deleteDemoAssetAction(input: {
  slug: string;
  slotKey: string;
}): Promise<DemoAssetActionResult<null>> {
  try {
    const actor = await requireActor();
    await deleteDemoAsset(actor, input);
    return { ok: true, data: null };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "deleteDemoAssetAction failed");
    return { ok: false, error: { code: errorCode(err) } };
  }
}
