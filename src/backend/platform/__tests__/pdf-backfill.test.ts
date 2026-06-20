import { describe, it, expect } from "vitest";
import { backfillNaTextFields } from "@/backend/platform/pdf";

/**
 * backfillNaTextFields — USCIS "no blank box" acceptance rule (8 CFR 1208.3(c)(3)).
 * Pure function (no mupdf), so it is unit-testable in isolation.
 */
describe("backfillNaTextFields", () => {
  const detected = [
    { pdf_field_name: "p1.name", field_type: "text", page: 1 },
    { pdf_field_name: "p1.ssn", field_type: "text", page: 1 },
    { pdf_field_name: "p1.sex", field_type: "checkbox", page: 1 }, // checkbox → never N/A
    { pdf_field_name: "p1.PreparerSignature", field_type: "text", page: 1 }, // office-use → never N/A
    { pdf_field_name: "p4.background", field_type: "text", page: 4 },
    { pdf_field_name: "p7.narrative", field_type: "text", page: 7 }, // out of form scope
  ];

  it("backfills blank applicant text fields on the form's pages with N/A", () => {
    const filled: Record<string, string | boolean> = { "p1.name": "Juan" };
    const n = backfillNaTextFields(detected, filled, ["p1.name", "p4.background"]);
    expect(filled["p1.name"]).toBe("Juan"); // already answered, untouched
    expect(filled["p1.ssn"]).toBe("N/A"); // blank text on a form page → N/A
    expect(filled["p4.background"]).toBe("N/A");
    expect(n).toBe(2);
  });

  it("never fills checkboxes or office-use/signature fields", () => {
    const filled: Record<string, string | boolean> = {};
    backfillNaTextFields(detected, filled, ["p1.name"]);
    expect(filled["p1.sex"]).toBeUndefined();
    expect(filled["p1.PreparerSignature"]).toBeUndefined();
  });

  it("scopes to the form's pages only (does not stamp another form's pages)", () => {
    const filled: Record<string, string | boolean> = {};
    backfillNaTextFields(detected, filled, ["p1.name"]); // form lives only on page 1
    expect(filled["p7.narrative"]).toBeUndefined(); // page 7 untouched
    expect(filled["p4.background"]).toBeUndefined(); // page 4 untouched (no form field there)
  });

  it("is a no-op when the form maps no fields", () => {
    const filled: Record<string, string | boolean> = {};
    expect(backfillNaTextFields(detected, filled, [])).toBe(0);
    expect(Object.keys(filled)).toHaveLength(0);
  });

  it("honours a custom placeholder", () => {
    const filled: Record<string, string | boolean> = {};
    backfillNaTextFields(detected, filled, ["p1.name"], "None");
    expect(filled["p1.ssn"]).toBe("None");
  });
});
