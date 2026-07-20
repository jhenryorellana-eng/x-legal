import { describe, it, expect } from "vitest";
import { ROLE_PRESETS } from "@/shared/constants/role-presets";

describe("ROLE_PRESETS", () => {
  it("admin has full access", () => {
    for (const cell of Object.values(ROLE_PRESETS.admin)) {
      expect(cell).toEqual({ view: true, edit: true });
    }
  });

  // Decisión de Henry 2026-07-20: Finanzas/Operaciones (Andrium) hace intake y
  // debe poder crear casos desde "Nuevo caso". createCaseFromContract exige
  // cases:edit y provisionClientUser/updateClientAddress exigen clients:edit.
  it("finance can create clients and cases", () => {
    expect(ROLE_PRESETS.finance.clients).toEqual({ view: true, edit: true });
    expect(ROLE_PRESETS.finance.cases).toEqual({ view: true, edit: true });
  });

  it("finance keeps its billing/collections domain", () => {
    expect(ROLE_PRESETS.finance.billing.edit).toBe(true);
    expect(ROLE_PRESETS.finance.collections.edit).toBe(true);
  });

  it("sales cannot create cases by preset (view-only on cases/clients)", () => {
    // Regression guard: only admin/finance create by default; sales gets the
    // grant per-user (Vanessa was granted edit explicitly, not via preset).
    expect(ROLE_PRESETS.sales.cases.edit).toBe(false);
    expect(ROLE_PRESETS.sales.clients.edit).toBe(false);
  });
});
