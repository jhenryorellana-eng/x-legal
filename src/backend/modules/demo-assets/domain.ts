/**
 * demo-assets — domain (pure rules, no IO).
 *
 * Real PDFs backing the admin live-demo (`/admin/demo`). Storage is the source
 * of truth — no companion table: each slot maps to a deterministic object path
 * `demo/{slug}/{slotKey}.pdf` in the private `catalog-assets` bucket, and
 * re-uploading upserts the same path. Slots are declared in
 * `src/shared/constants/demo-assets.ts` (shared with the frontend).
 *
 * @module demo-assets/domain
 */

import { isDemoAssetSlotKey, getDemoAssetSlots } from "@/shared/constants/demo-assets";

export type DemoAssetsErrorCode =
  | "unknown_scenario"
  | "unknown_slot"
  | "invalid_file"
  | "not_found";

export class DemoAssetsError extends Error {
  constructor(public readonly code: DemoAssetsErrorCode, message?: string) {
    super(message ?? code);
    this.name = "DemoAssetsError";
  }
}

/** Demo PDFs live with the other admin-managed material (DOC-30 §14). */
export const DEMO_ASSETS_BUCKET = "catalog-assets";

/** Prefix listing yields exactly one object per uploaded slot. */
export function demoAssetPrefix(slug: string): string {
  return `demo/${slug}`;
}

/** Server-side deterministic path (DOC-27 §5: clients never control paths). */
export function demoAssetPath(slug: string, slotKey: string): string {
  return `${demoAssetPrefix(slug)}/${slotKey}.pdf`;
}

/** Storage object name for a slot, as returned by a prefix listing. */
export function demoAssetObjectName(slotKey: string): string {
  return `${slotKey}.pdf`;
}

export function assertValidScenario(slug: string): void {
  if (getDemoAssetSlots(slug).length === 0) {
    throw new DemoAssetsError("unknown_scenario", `No demo asset slots for "${slug}"`);
  }
}

export function assertValidSlot(slug: string, slotKey: string): void {
  assertValidScenario(slug);
  if (!isDemoAssetSlotKey(slug, slotKey)) {
    throw new DemoAssetsError("unknown_slot", `Unknown slot "${slotKey}" for "${slug}"`);
  }
}
