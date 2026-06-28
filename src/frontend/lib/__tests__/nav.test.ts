/**
 * Regression: role-aware staff navigation (DOC-54 §0.2).
 * Diana (paralegal) must get the curated legal sidebar — the admin STAFF_NAV
 * never surfaced /legal (her kanban) and pointed "Expedientes" at a 404.
 */
import { describe, it, expect } from "vitest";
import { navForRole, LEGAL_NAV, STAFF_NAV } from "../nav";

describe("navForRole", () => {
  it("gives the paralegal the curated legal sidebar", () => {
    expect(navForRole("paralegal")).toBe(LEGAL_NAV);
  });

  it("keeps admin/sales/finance on the full org tree", () => {
    for (const role of ["admin", "sales", "finance", null, undefined] as const) {
      expect(navForRole(role)).toBe(STAFF_NAV);
    }
  });

  it("legal sidebar surfaces the paralegal's own kanban (/legal)", () => {
    const hrefs = LEGAL_NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/legal");
    expect(hrefs).toContain("/legal/mi-dia");
    expect(hrefs).toContain("/legal/por-revisar");
    expect(hrefs).toContain("/legal/expediente");
    expect(hrefs).toContain("/legal/validaciones");
  });

  it("every legal item gates on a module the paralegal owns", () => {
    const dianaModules = new Set([
      "dashboard",
      "cases",
      "expedientes",
      "validations",
      "calendar",
      "messaging",
      "clients",
    ]);
    for (const group of LEGAL_NAV) {
      for (const item of group.items) {
        expect(dianaModules.has(item.module)).toBe(true);
      }
    }
  });
});
