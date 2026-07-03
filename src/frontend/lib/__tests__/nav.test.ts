/**
 * Regression: role-aware staff navigation (DOC-54 §0.2).
 * Diana (paralegal) must get the curated legal sidebar — the admin STAFF_NAV
 * never surfaced /legal (her kanban) and pointed "Expedientes" at a 404.
 */
import { describe, it, expect } from "vitest";
import { filterNav, navForRole, LEGAL_NAV, SALES_NAV, STAFF_NAV } from "../nav";

describe("navForRole", () => {
  it("gives the paralegal the curated legal sidebar", () => {
    expect(navForRole("paralegal")).toBe(LEGAL_NAV);
  });

  it("gives sales the curated Ventas sidebar", () => {
    expect(navForRole("sales")).toBe(SALES_NAV);
  });

  it("keeps admin/finance on the full org tree", () => {
    for (const role of ["admin", "finance", null, undefined] as const) {
      expect(navForRole(role)).toBe(STAFF_NAV);
    }
  });

  it("sales sidebar drops the Operación and Finanzas groups but keeps Clientes", () => {
    expect(SALES_NAV.map((g) => g.labelKey)).toEqual(["sales"]);
    const hrefs = SALES_NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/ventas/clientes");
    expect(hrefs).toContain("/ventas/casos");
    expect(hrefs).not.toContain("/finanzas/casos");
    expect(hrefs).not.toContain("/admin/casos");
  });

  it("legal sidebar surfaces the global Clientes tab", () => {
    const hrefs = LEGAL_NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/ventas/clientes");
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

/**
 * Regression: sidebar reorg — the old "Catálogo" group became "Gerencia"
 * (management) and a new marketing "Catálogo" group holds the demo entry
 * renamed to "Servicios" (demoServices).
 */
describe("STAFF_NAV structure", () => {
  it("orders the groups with Gerencia before the marketing Catálogo", () => {
    expect(STAFF_NAV.map((g) => g.labelKey)).toEqual([
      "general",
      "operations",
      "sales",
      "finance",
      "management",
      "catalog",
      "administration",
    ]);
  });

  it("keeps the service builder and datasets under Gerencia", () => {
    const management = STAFF_NAV.find((g) => g.labelKey === "management");
    expect(management?.items.map((i) => i.labelKey)).toEqual(["services", "datasets"]);
    expect(management?.items.map((i) => i.href)).toEqual(["/admin/catalogo", "/admin/datasets"]);
  });

  it("the marketing Catálogo group holds only the admin-only demo entry", () => {
    const catalog = STAFF_NAV.find((g) => g.labelKey === "catalog");
    expect(catalog?.items).toHaveLength(1);
    expect(catalog?.items[0]).toMatchObject({
      labelKey: "demoServices",
      href: "/admin/demo",
      adminOnly: true,
    });
  });

  it("the demo entry no longer lives under Administración", () => {
    const administration = STAFF_NAV.find((g) => g.labelKey === "administration");
    expect(administration?.items.map((i) => i.href)).not.toContain("/admin/demo");
  });

  it("filterNav drops the whole Catálogo group for non-admins", () => {
    const visible = filterNav(STAFF_NAV, (item) => !item.adminOnly);
    expect(visible.map((g) => g.labelKey)).not.toContain("catalog");
  });
});
