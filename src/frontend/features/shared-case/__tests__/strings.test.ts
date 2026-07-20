import { describe, it, expect } from "vitest";
import { buildCasosStrings, resolveCasosActionError } from "../strings";

describe("resolveCasosActionError", () => {
  const es = buildCasosStrings("es");
  const en = buildCasosStrings("en");

  it("maps permission-denial codes to the permission message", () => {
    for (const code of ["forbidden_module", "forbidden_case", "wrong_kind", "cross_org_access_denied"]) {
      expect(resolveCasosActionError(code, es)).toBe(es.actionError.permission);
    }
  });

  it("maps session codes to the session message", () => {
    expect(resolveCasosActionError("unauthenticated", es)).toBe(es.actionError.session);
    expect(resolveCasosActionError("inactive", es)).toBe(es.actionError.session);
  });

  it("maps validation codes to their specific message", () => {
    expect(resolveCasosActionError("INVALID_ADDRESS", es)).toBe(es.actionError.address);
    expect(resolveCasosActionError("INVALID_EMAIL", es)).toBe(es.actionError.email);
    expect(resolveCasosActionError("INVALID_PHONE", es)).toBe(es.actionError.phone);
    expect(resolveCasosActionError("INVALID_PLAN", es)).toBe(es.actionError.plan);
    expect(resolveCasosActionError("CONTRACT_TOKEN_INVALID", es)).toBe(es.actionError.signingLink);
  });

  it("degrades unknown/undefined codes to the neutral generic message (never the load-cases string)", () => {
    expect(resolveCasosActionError("internal", es)).toBe(es.actionError.generic);
    expect(resolveCasosActionError(undefined, es)).toBe(es.actionError.generic);
    expect(resolveCasosActionError("internal", es)).not.toBe(es.errorTitle);
  });

  it("is localized (en resolves to the English strings)", () => {
    expect(resolveCasosActionError("forbidden_module", en)).toBe(en.actionError.permission);
    expect(resolveCasosActionError(undefined, en)).toBe(en.actionError.generic);
  });
});
