/**
 * Demo asset slots — single source of truth shared by frontend and backend.
 *
 * Each demo scenario (`src/frontend/features/admin/demo/scenarios/`) declares
 * here the real PDFs the admin can upload from the "⋯ → Data" menu on the
 * `/admin/demo` card. The staff view shows the uploaded PDF when the matching
 * generation finishes; a slot without a PDF falls back to the pure-UI HTML
 * simulation. Adding a new demo = a new entry here + the scenario fixture —
 * zero infra changes (objects live at `demo/{slug}/{key}.pdf` in the
 * `catalog-assets` bucket).
 *
 * Titles/labels are plain Spanish on purpose: like the scenario fixtures, demo
 * content is authored (already localized) data, not chrome (DOC-53 demo tab).
 */

export interface DemoAssetSlot {
  /** Stable key — becomes the storage object name: `demo/{slug}/{key}.pdf`. */
  key: string;
  /** Row title in the Data modal. */
  title: string;
  /** Staff-view tab where the PDF is shown. */
  tabLabel: string;
}

/** Upload ceiling — the `catalog-assets` bucket limit (50 MiB, migration 0014). */
export const DEMO_ASSET_MAX_BYTES = 50 * 1024 * 1024;

export const DEMO_ASSET_SLOTS: Record<string, readonly DemoAssetSlot[]> = {
  "asilo-politico": [
    { key: "i589", title: "Formulario I-589", tabLabel: "Automatización" },
    { key: "memo", title: "Memorándum de Miedo Creíble", tabLabel: "Generaciones" },
    { key: "expediente", title: "Expediente completo", tabLabel: "Expediente" },
  ],
};

export function getDemoAssetSlots(slug: string): readonly DemoAssetSlot[] {
  return DEMO_ASSET_SLOTS[slug] ?? [];
}

export function isDemoAssetSlotKey(slug: string, key: string): boolean {
  return getDemoAssetSlots(slug).some((slot) => slot.key === key);
}
