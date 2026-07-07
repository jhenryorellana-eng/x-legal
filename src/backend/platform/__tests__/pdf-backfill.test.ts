import { describe, it, expect } from "vitest";
import { backfillNaTextFields } from "@/backend/platform/pdf";

/**
 * backfillNaTextFields — USCIS "no blank box" acceptance rule (8 CFR 1208.3(c)(3)).
 * Pure function (no mupdf), so it is unit-testable in isolation.
 *
 * New (targeted) contract: the caller passes the EXPLICIT set of applicable,
 * still-empty text questions to back-fill. The helper only enforces the two hard
 * rules — never a non-text widget, never an office-use/signature field. Fields the
 * caller does NOT list (hidden by a condition, in a do-not-fill section) stay blank.
 */
describe("backfillNaTextFields", () => {
  const detected = [
    { pdf_field_name: "p1.name", field_type: "text", page: 1 },
    { pdf_field_name: "p1.ssn", field_type: "text", page: 1 },
    { pdf_field_name: "p1.sex", field_type: "checkbox", page: 1 }, // checkbox → never N/A
    { pdf_field_name: "p1.PreparerSignature", field_type: "text", page: 1 }, // office-use → never N/A
    { pdf_field_name: "p2.spouseName", field_type: "text", page: 2 }, // hidden block → not a target
    { pdf_field_name: "p4.background", field_type: "text", page: 4 },
  ];

  it("back-fills only the applicable, blank text targets it is given", () => {
    const filled: Record<string, string | boolean> = { "p1.name": "Juan" };
    const n = backfillNaTextFields(detected, filled, ["p1.name", "p1.ssn", "p4.background"]);
    expect(filled["p1.name"]).toBe("Juan"); // already answered, untouched
    expect(filled["p1.ssn"]).toBe("N/A"); // blank applicable text → N/A
    expect(filled["p4.background"]).toBe("N/A");
    expect(n).toBe(2);
  });

  it("never fills checkboxes or office-use/signature fields even if passed as targets", () => {
    const filled: Record<string, string | boolean> = {};
    backfillNaTextFields(detected, filled, ["p1.sex", "p1.PreparerSignature"]);
    expect(filled["p1.sex"]).toBeUndefined();
    expect(filled["p1.PreparerSignature"]).toBeUndefined();
  });

  it("leaves fields blank when they are NOT in the target set (hidden/do-not-fill blocks)", () => {
    const filled: Record<string, string | boolean> = {};
    // The spouse block is hidden (single applicant) → the caller does not list it.
    backfillNaTextFields(detected, filled, ["p1.name"]);
    expect(filled["p2.spouseName"]).toBeUndefined(); // stays blank — the core fix
    expect(filled["p4.background"]).toBeUndefined();
    expect(filled["p1.name"]).toBe("N/A");
  });

  it("tolerates a target with no detected entry (still fills it as text)", () => {
    const filled: Record<string, string | boolean> = {};
    backfillNaTextFields(detected, filled, ["unknown.field"]);
    expect(filled["unknown.field"]).toBe("N/A");
  });

  it("is a no-op when there are no targets", () => {
    const filled: Record<string, string | boolean> = {};
    expect(backfillNaTextFields(detected, filled, [])).toBe(0);
    expect(Object.keys(filled)).toHaveLength(0);
  });

  it("honours a custom placeholder", () => {
    const filled: Record<string, string | boolean> = {};
    backfillNaTextFields(detected, filled, ["p1.ssn"], "None");
    expect(filled["p1.ssn"]).toBe("None");
  });
});
