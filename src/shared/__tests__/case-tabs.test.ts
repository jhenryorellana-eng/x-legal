/**
 * Regression: the case-workspace "letters" tab consolidation (2026-07-08, DOC-15
 * RF-TRX-025 / DOC-54 §3). The old duplicate id `cartas` was retired in favour of
 * the single canonical `generaciones`; a data migration (0075) merged the per-role
 * `case_tab_role_access` overrides. These tests lock the invariants that keep the
 * next tab-id rename honest and guard "the paralegal keeps the Generaciones tab".
 */
import { describe, it, expect } from "vitest";
import {
  CASE_TAB_IDS,
  CANONICAL_TAB_ORDER,
  ROLE_DEFAULT_TAB_ORDER,
  isCaseTabId,
  resolveRoleTabIds,
} from "../constants/case-tabs";

describe("case-tabs consolidation (cartas → generaciones)", () => {
  it("retired the `cartas` id everywhere; `generaciones` is canonical", () => {
    expect(isCaseTabId("generaciones")).toBe(true);
    expect(isCaseTabId("cartas")).toBe(false);
    expect((CASE_TAB_IDS as readonly string[])).not.toContain("cartas");
    expect((CANONICAL_TAB_ORDER as readonly string[])).not.toContain("cartas");
    for (const role of ["admin", "sales", "paralegal", "finance"] as const) {
      expect(ROLE_DEFAULT_TAB_ORDER[role] as readonly string[]).not.toContain("cartas");
    }
  });

  it("paralegal default set includes `generaciones` (the renamed tab)", () => {
    const tabs = resolveRoleTabIds("paralegal", null);
    expect(tabs).toContain("generaciones");
    expect(tabs).not.toContain("cartas");
  });

  it("keeps the paralegal tab when the override enables `generaciones` (migration 0075 invariant)", () => {
    // After 0075 the paralegal override row is generaciones=true (merged from cartas).
    const override = ["resumen", "documentos", "formularios", "generaciones", "expediente"] as const;
    const tabs = resolveRoleTabIds("paralegal", override);
    expect(tabs).toContain("generaciones");
    // Order follows the role's default order, not the override's array order.
    expect(tabs.indexOf("resumen")).toBeLessThan(tabs.indexOf("generaciones"));
  });

  it("hides a tab dropped from the override (Contrato/Ruta de citas for paralegal)", () => {
    const override = ["resumen", "documentos", "formularios", "generaciones"] as const;
    const tabs = resolveRoleTabIds("paralegal", override);
    expect(tabs).not.toContain("contrato");
    expect(tabs).not.toContain("citas");
  });

  it("null override falls back to the full role default set", () => {
    expect(resolveRoleTabIds("paralegal", null)).toEqual(ROLE_DEFAULT_TAB_ORDER.paralegal);
  });
});
