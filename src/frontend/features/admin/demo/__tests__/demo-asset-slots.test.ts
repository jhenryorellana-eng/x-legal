/**
 * Anti-drift: the demo scenario registry (frontend fixture) and the asset slot
 * map (shared constants, consumed by the backend too) must stay in sync — a
 * new demo without declared slots would silently ship without its "⋯ → Data"
 * menu, and orphan slots would expose upload paths for demos that don't exist.
 */

import { describe, it, expect } from "vitest";
import { DEMO_SCENARIOS } from "../scenarios";
import { DEMO_ASSET_SLOTS, getDemoAssetSlots } from "@/shared/constants/demo-assets";

describe("demo asset slots ↔ scenario registry", () => {
  it("every registered scenario declares its asset slots", () => {
    for (const slug of Object.keys(DEMO_SCENARIOS)) {
      expect(getDemoAssetSlots(slug).length, `missing DEMO_ASSET_SLOTS for "${slug}"`).toBeGreaterThan(0);
    }
  });

  it("every slot entry points at a registered scenario", () => {
    for (const slug of Object.keys(DEMO_ASSET_SLOTS)) {
      expect(DEMO_SCENARIOS[slug], `orphan DEMO_ASSET_SLOTS entry "${slug}"`).toBeDefined();
    }
  });

  it("slot keys are unique per scenario and carry title + tabLabel", () => {
    for (const [slug, slots] of Object.entries(DEMO_ASSET_SLOTS)) {
      const keys = slots.map((s) => s.key);
      expect(new Set(keys).size, `duplicate slot keys in "${slug}"`).toBe(keys.length);
      for (const slot of slots) {
        expect(slot.title.length).toBeGreaterThan(0);
        expect(slot.tabLabel.length).toBeGreaterThan(0);
      }
    }
  });

  it("asilo-politico covers the three staff generations the tabs consume", () => {
    // staff-view.tsx wires these exact keys to the Automatización / Generaciones
    // / Expediente tabs.
    expect(getDemoAssetSlots("asilo-politico").map((s) => s.key)).toEqual([
      "i589",
      "memo",
      "expediente",
    ]);
  });
});
