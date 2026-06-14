/**
 * Regression: staff landing routes (DOC-22 §5.4).
 * Caught live (2026-06-14): a sales user (Vanessa) logging in landed on /admin,
 * which crashed on listServicesAdmin (forbidden_module). Each role must land on
 * its own panel.
 */
import { describe, it, expect } from "vitest";
import { staffHomePath } from "../staff-routes";

describe("staffHomePath", () => {
  it("routes each role to its own panel", () => {
    expect(staffHomePath("admin")).toBe("/admin");
    expect(staffHomePath("sales")).toBe("/ventas/mi-dia");
    expect(staffHomePath("paralegal")).toBe("/legal");
    expect(staffHomePath("finance")).toBe("/finanzas");
  });

  it("never sends a non-admin role to /admin (the crash route)", () => {
    for (const role of ["sales", "paralegal", "finance"] as const) {
      expect(staffHomePath(role)).not.toBe("/admin");
    }
  });

  it("defaults null/unknown role away from /admin", () => {
    expect(staffHomePath(null)).not.toBe("/admin");
  });
});
