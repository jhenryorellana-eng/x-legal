import { describe, it, expect } from "vitest";
import { classifySaveError, TRANSIENT_SAVE_CODES } from "../classify-save-error";

/**
 * The autosave engine must distinguish errors worth retrying (network hiccups,
 * server-side transients, creation races) from errors a retry can never fix
 * (the form was submitted elsewhere, the version is stale, the value is the
 * wrong type). Retrying a permanent error forever leaves the user stuck in
 * "error" and hammers the server — the bug this classifier removes.
 */
describe("classifySaveError", () => {
  it("classifies form-state rejections as permanent (a retry can't fix them)", () => {
    expect(classifySaveError("FORM_NOT_SUBMITTABLE")).toBe("permanent");
    expect(classifySaveError("FORM_VERSION_MISMATCH")).toBe("permanent");
    expect(classifySaveError("FORM_VALIDATION_FAILED")).toBe("permanent");
    expect(classifySaveError("FORM_NOT_EDITABLE_BY_CLIENT")).toBe("permanent");
    expect(classifySaveError("FORM_NOT_FOUND")).toBe("permanent");
    expect(classifySaveError("FORM_VERSION_NOT_PUBLISHED")).toBe("permanent");
    expect(classifySaveError("CASE_NOT_FOUND")).toBe("permanent");
  });

  it("classifies UNEXPECTED and creation-race errors as transient (retry)", () => {
    expect(classifySaveError("UNEXPECTED")).toBe("transient");
    expect(classifySaveError("FORM_RESPONSE_NOT_FOUND")).toBe("transient");
  });

  it("defaults unknown/absent codes to permanent (never an infinite retry loop)", () => {
    expect(classifySaveError("SOMETHING_BRAND_NEW")).toBe("permanent");
    expect(classifySaveError(undefined)).toBe("permanent");
    expect(classifySaveError("")).toBe("permanent");
  });

  it("exposes the transient set as the single source of truth", () => {
    expect(TRANSIENT_SAVE_CODES.has("UNEXPECTED")).toBe(true);
    expect(TRANSIENT_SAVE_CODES.has("FORM_RESPONSE_NOT_FOUND")).toBe(true);
    expect(TRANSIENT_SAVE_CODES.has("FORM_NOT_SUBMITTABLE")).toBe(false);
  });
});
