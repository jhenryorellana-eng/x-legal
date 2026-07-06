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

  it("every scenario wires its present micro-experiences to declared slot keys", () => {
    // staff-view.tsx resolves each tab's PDF via staff.{automation,generation,
    // expediente}.slotKey — those keys must be exactly the declared slots. The
    // automation micro-experience is optional (e.g. Reforzar Asilo omits it), so
    // the wiring is derived from whichever fixtures the scenario actually declares.
    for (const [slug, scenario] of Object.entries(DEMO_SCENARIOS)) {
      const wired = [
        scenario.staff.automation?.slotKey,
        scenario.staff.generation.slotKey,
        scenario.staff.expediente.slotKey,
      ].filter((k): k is string => Boolean(k));
      const declared = getDemoAssetSlots(slug).map((s) => s.key);
      expect(new Set(wired).size, `colliding slotKeys in "${slug}"`).toBe(wired.length);
      expect([...declared].sort(), `slots ↔ slotKeys drift in "${slug}"`).toEqual([...wired].sort());
    }
  });
});
