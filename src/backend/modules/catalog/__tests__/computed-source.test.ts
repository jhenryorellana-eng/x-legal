/**
 * Catalog domain — `computed` question source (derived totals, EOIR-26A).
 *
 * A computed question maps a total box to an arithmetic function of sibling
 * questions. The schema must accept { op, inputs } and publication validation must
 * reject a malformed ref, a self-reference, a subtract with <2 inputs, and inputs
 * that don't exist in the version. See src/shared/form-logic/computed.ts.
 */

import { describe, it, expect } from "vitest";

import { SourceRefSchema, validateSourceRef, type Question, type VersionCtx } from "../domain";

const BASE_CTX: VersionCtx = {
  documentSlugsWithSchema: {},
  aiLetterSlugs: [],
  profileFields: [],
  allDocumentSlugs: [],
};

function computedQuestion(id: string, source_ref: unknown): Question {
  return { id, source: "computed", field_type: "number", options: null, source_ref } as unknown as Question;
}

describe("SourceRefSchema — computed", () => {
  it("accepts a valid sum ref", () => {
    const parsed = SourceRefSchema.safeParse({
      source: "computed",
      source_ref: { op: "sum", inputs: ["a", "b", "c"] },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown op and an empty inputs list", () => {
    expect(SourceRefSchema.safeParse({ source: "computed", source_ref: { op: "multiply", inputs: ["a"] } }).success).toBe(false);
    expect(SourceRefSchema.safeParse({ source: "computed", source_ref: { op: "sum", inputs: [] } }).success).toBe(false);
  });
});

describe("validateSourceRef — computed", () => {
  const ctx: VersionCtx = { ...BASE_CTX, questionIds: new Set(["self", "a", "b"]) };

  it("passes when inputs exist and op/arity are valid", () => {
    const issues = validateSourceRef(computedQuestion("self", { op: "subtract", inputs: ["a", "b"] }), ctx);
    expect(issues).toEqual([]);
  });

  it("blocks a malformed ref", () => {
    const issues = validateSourceRef(computedQuestion("self", { op: "sum" }), ctx);
    expect(issues.some((i) => i.code === "CATALOG_SOURCE_REF_INVALID")).toBe(true);
  });

  it("blocks a subtract with fewer than 2 inputs", () => {
    const issues = validateSourceRef(computedQuestion("self", { op: "subtract", inputs: ["a"] }), ctx);
    expect(issues.some((i) => i.detail.includes("subtract"))).toBe(true);
  });

  it("blocks a self-reference", () => {
    const issues = validateSourceRef(computedQuestion("self", { op: "sum", inputs: ["self", "a"] }), ctx);
    expect(issues.some((i) => i.detail.includes("sí misma"))).toBe(true);
  });

  it("blocks inputs that don't exist in the version", () => {
    const issues = validateSourceRef(computedQuestion("self", { op: "sum", inputs: ["a", "ghost"] }), ctx);
    expect(issues.some((i) => i.detail.includes("ghost"))).toBe(true);
  });

  it("skips the existence check when the id set is absent (isolated validation)", () => {
    const issues = validateSourceRef(computedQuestion("self", { op: "sum", inputs: ["a", "ghost"] }), BASE_CTX);
    expect(issues).toEqual([]);
  });

  it("blocks an operand whose source the evaluator can't read (profile/extraction/ai_field)", () => {
    const ctxWithSources: VersionCtx = {
      ...BASE_CTX,
      questionIds: new Set(["self", "a", "prof"]),
      questionSourceById: new Map([
        ["self", "computed"],
        ["a", "client_answer"],
        ["prof", "profile"], // not readable by resolveComputedValues → contributes 0 silently
      ]),
    };
    const issues = validateSourceRef(computedQuestion("self", { op: "sum", inputs: ["a", "prof"] }), ctxWithSources);
    expect(issues.some((i) => i.detail.includes("prof"))).toBe(true);
  });

  it("allows client_answer and computed operands", () => {
    const ctxWithSources: VersionCtx = {
      ...BASE_CTX,
      questionIds: new Set(["self", "a", "b"]),
      questionSourceById: new Map([
        ["self", "computed"],
        ["a", "client_answer"],
        ["b", "computed"],
      ]),
    };
    expect(validateSourceRef(computedQuestion("self", { op: "sum", inputs: ["a", "b"] }), ctxWithSources)).toEqual([]);
  });
});
