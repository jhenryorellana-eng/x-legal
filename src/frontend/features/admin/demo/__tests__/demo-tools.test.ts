/**
 * Anti-drift: the demo-tool registry (shared constants, consumed by the
 * middleware CSP and the /admin/demo pages) must stay coherent on its own AND
 * against the scenario registry — [slug]/page.tsx resolves scenarios first, so
 * a colliding slug would silently shadow the tool; and `icon` is a plain
 * string in shared (boundaries: shared cannot import frontend), so only this
 * test guarantees it names a real brand icon.
 */

import { describe, it, expect } from "vitest";
import { DEMO_SCENARIOS } from "../scenarios";
import { ICON_NAMES } from "@/frontend/components/brand";
import {
  DEMO_TOOLS,
  DEMO_TOOL_FRAME_ORIGINS,
  listDemoTools,
} from "@/shared/constants/demo-tools";

describe("demo tools registry", () => {
  it("no tool slug collides with a scenario slug", () => {
    for (const slug of Object.keys(DEMO_TOOLS)) {
      expect(DEMO_SCENARIOS[slug], `tool slug "${slug}" shadowed by a scenario`).toBeUndefined();
    }
  });

  it("slugs are url-safe, match their record key and carry a label", () => {
    for (const [key, tool] of Object.entries(DEMO_TOOLS)) {
      expect(tool.slug).toBe(key);
      expect(tool.slug).toMatch(/^[a-z0-9-]+$/);
      expect(tool.label.length).toBeGreaterThan(0);
    }
  });

  it("every tool URL is a valid https URL", () => {
    for (const tool of listDemoTools()) {
      const url = new URL(tool.url); // throws if invalid
      expect(url.protocol, `"${tool.slug}" must embed over https`).toBe("https:");
    }
  });

  it("every tool icon is a real brand IconName", () => {
    for (const tool of listDemoTools()) {
      expect(ICON_NAMES, `unknown icon "${tool.icon}" in "${tool.slug}"`).toContain(tool.icon);
    }
  });

  it("frame origins cover every tool, deduped, as pure origins (no paths)", () => {
    const expected = new Set(listDemoTools().map((t) => new URL(t.url).origin));
    expect(new Set(DEMO_TOOL_FRAME_ORIGINS)).toEqual(expected);
    expect(DEMO_TOOL_FRAME_ORIGINS.length).toBe(expected.size);
    for (const origin of DEMO_TOOL_FRAME_ORIGINS) {
      expect(origin, `"${origin}" must be a bare origin`).toBe(new URL(origin).origin);
    }
  });
});
