/**
 * demo-assets — service (business logic + authorization).
 *
 * Everything is admin-only: the demo is an admin-exclusive marketing surface
 * (nav gate `adminOnly`, DOC-53 demo tab) and its PDFs are org marketing
 * material, not case data. All signed URLs are produced server-side with the
 * service client, so bucket RLS never applies.
 *
 * @module demo-assets/service
 */

import { AuthzError, type Actor } from "@/backend/platform/authz";
import {
  createSignedDownloadUrl,
  createSignedUploadUrl,
  deleteObject,
  listObjects,
  validateUploadedObject,
} from "@/backend/platform/storage";
import { logger } from "@/backend/platform/logger";
import { writeAudit } from "@/backend/modules/audit";
import { DEMO_ASSET_MAX_BYTES, getDemoAssetSlots } from "@/shared/constants/demo-assets";
import {
  DEMO_ASSETS_BUCKET,
  DemoAssetsError,
  assertValidScenario,
  assertValidSlot,
  demoAssetObjectName,
  demoAssetPath,
  demoAssetPrefix,
} from "./domain";

export interface DemoAssetSlotStatus {
  key: string;
  uploaded: boolean;
  updatedAt: string | null;
  sizeBytes: number | null;
}

function assertAdmin(actor: Actor): void {
  if (actor.kind !== "staff" || actor.role !== "admin") {
    throw new AuthzError("forbidden_module");
  }
}

/** Upload state per declared slot — one prefix listing for the whole scenario. */
export async function listDemoAssetStatus(
  actor: Actor,
  slug: string,
): Promise<DemoAssetSlotStatus[]> {
  assertAdmin(actor);
  assertValidScenario(slug);

  const objects = await listObjects(DEMO_ASSETS_BUCKET, demoAssetPrefix(slug));
  const byName = new Map(objects.map((o) => [o.name, o]));

  return getDemoAssetSlots(slug).map((slot) => {
    const obj = byName.get(demoAssetObjectName(slot.key));
    return {
      key: slot.key,
      uploaded: Boolean(obj),
      updatedAt: obj?.updatedAt ?? null,
      sizeBytes: obj?.sizeBytes ?? null,
    };
  });
}

/**
 * Signed upload URL for a slot. Upsert: the path is deterministic, so
 * re-uploading replaces the previous PDF without a delete round-trip.
 */
export async function createDemoAssetUploadUrl(
  actor: Actor,
  input: { slug: string; slotKey: string },
): Promise<{ signedUrl: string; path: string }> {
  assertAdmin(actor);
  assertValidSlot(input.slug, input.slotKey);

  return createSignedUploadUrl(
    DEMO_ASSETS_BUCKET,
    demoAssetPath(input.slug, input.slotKey),
    { upsert: true },
  );
}

/**
 * Post-PUT confirmation: validates the object (extension, magic bytes, size up
 * to the bucket's 50 MiB) — an invalid object is deleted by the validator and
 * the slot reads as empty again.
 */
export async function confirmDemoAssetUpload(
  actor: Actor,
  input: { slug: string; slotKey: string },
): Promise<DemoAssetSlotStatus> {
  assertAdmin(actor);
  assertValidSlot(input.slug, input.slotKey);

  const path = demoAssetPath(input.slug, input.slotKey);
  const result = await validateUploadedObject(DEMO_ASSETS_BUCKET, path, "catalog-assets", {
    maxBytes: DEMO_ASSET_MAX_BYTES,
  });

  if (!result.ok) {
    throw new DemoAssetsError("invalid_file", result.reason);
  }

  const sizeBytes = result.bytes?.length ?? null;
  await writeAudit(actor, "demo_assets.uploaded", "demo_asset", `${input.slug}/${input.slotKey}`, {
    after: { sizeBytes },
  });

  return {
    key: input.slotKey,
    uploaded: true,
    updatedAt: new Date().toISOString(),
    sizeBytes,
  };
}

/** Removes a slot's PDF — the demo falls back to the HTML simulation. */
export async function deleteDemoAsset(
  actor: Actor,
  input: { slug: string; slotKey: string },
): Promise<void> {
  assertAdmin(actor);
  assertValidSlot(input.slug, input.slotKey);

  await deleteObject(DEMO_ASSETS_BUCKET, demoAssetPath(input.slug, input.slotKey));
  await writeAudit(actor, "demo_assets.deleted", "demo_asset", `${input.slug}/${input.slotKey}`, {
    after: null,
  });
}

/**
 * Signed download URLs per slot for the demo flow page (slot key → URL, or
 * null when no PDF is uploaded). Resilient per slot: a failed signature must
 * degrade that slot to the HTML simulation, never break the live.
 */
export async function getDemoAssetUrls(
  actor: Actor,
  slug: string,
): Promise<Record<string, string | null>> {
  assertAdmin(actor);

  const slots = getDemoAssetSlots(slug);
  const urls: Record<string, string | null> = {};
  if (slots.length === 0) return urls;

  const uploaded = new Set(
    (await listObjects(DEMO_ASSETS_BUCKET, demoAssetPrefix(slug))).map((o) => o.name),
  );

  await Promise.all(
    slots.map(async (slot) => {
      if (!uploaded.has(demoAssetObjectName(slot.key))) {
        urls[slot.key] = null;
        return;
      }
      try {
        urls[slot.key] = await createSignedDownloadUrl(
          DEMO_ASSETS_BUCKET,
          demoAssetPath(slug, slot.key),
        );
      } catch (err) {
        logger.warn(
          { slug, slotKey: slot.key, err: (err as Error).message },
          "demo-assets: failed to sign download URL — slot falls back to simulation",
        );
        urls[slot.key] = null;
      }
    }),
  );

  return urls;
}
