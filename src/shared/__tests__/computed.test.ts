import { describe, it, expect } from "vitest";
import {
  parseMoneyNumber,
  formatComputedResult,
  parseComputedSourceRef,
  resolveComputedValues,
  findComputedCycle,
  type ComputedQuestionLike,
} from "@/shared/form-logic/computed";

describe("parseMoneyNumber", () => {
  it("parses plain and formatted currency strings", () => {
    expect(parseMoneyNumber("1400")).toBe(1400);
    expect(parseMoneyNumber("1,400.50")).toBe(1400.5);
    expect(parseMoneyNumber("$1,400")).toBe(1400);
    expect(parseMoneyNumber(" 300 ")).toBe(300);
    expect(parseMoneyNumber("1,234,567.89")).toBe(1234567.89);
  });

  it("accepts bare numbers", () => {
    expect(parseMoneyNumber(950)).toBe(950);
    expect(parseMoneyNumber(-500)).toBe(-500);
  });

  it("reads accounting negatives and explicit minus", () => {
    expect(parseMoneyNumber("(500)")).toBe(-500);
    expect(parseMoneyNumber("-500")).toBe(-500);
    expect(parseMoneyNumber("($1,200.00)")).toBe(-1200);
  });

  it("treats blank / non-numeric / nullish as 0 (never NaN)", () => {
    expect(parseMoneyNumber("")).toBe(0);
    expect(parseMoneyNumber("   ")).toBe(0);
    expect(parseMoneyNumber("N/A")).toBe(0);
    expect(parseMoneyNumber(null)).toBe(0);
    expect(parseMoneyNumber(undefined)).toBe(0);
    expect(parseMoneyNumber({})).toBe(0);
    expect(parseMoneyNumber("1.2.3")).toBe(0);
  });
});

describe("formatComputedResult", () => {
  it("renders 2 decimals with thousands separators", () => {
    expect(formatComputedResult(1400)).toBe("1,400.00");
    expect(formatComputedResult(1400.5)).toBe("1,400.50");
    expect(formatComputedResult(0)).toBe("0.00");
    expect(formatComputedResult(1234567.89)).toBe("1,234,567.89");
  });

  it("renders negatives with a leading minus", () => {
    expect(formatComputedResult(-500)).toBe("-500.00");
    expect(formatComputedResult(-1234.5)).toBe("-1,234.50");
  });

  it("rounds binary FP noise to clean cents", () => {
    expect(formatComputedResult(0.1 + 0.2)).toBe("0.30");
  });
});

describe("parseComputedSourceRef", () => {
  it("accepts a valid ref", () => {
    expect(parseComputedSourceRef({ op: "sum", inputs: ["a", "b"] })).toEqual({
      op: "sum",
      inputs: ["a", "b"],
    });
  });

  it("rejects malformed refs", () => {
    expect(parseComputedSourceRef(null)).toBeNull();
    expect(parseComputedSourceRef({ op: "multiply", inputs: ["a"] })).toBeNull();
    expect(parseComputedSourceRef({ op: "sum", inputs: [] })).toBeNull();
    expect(parseComputedSourceRef({ op: "sum" })).toBeNull();
  });
});

describe("resolveComputedValues (EOIR-26A shape)", () => {
  // Part 1 income line items + 1.A total; Part 2 expense items + 2.B total;
  // Part 3 copies of 1.A / 2.B and the net TOTAL = 1.A − 2.B.
  const questions: ComputedQuestionLike[] = [
    { id: "inc1", source: "client_answer", source_ref: null },
    { id: "inc2", source: "client_answer", source_ref: null },
    { id: "inc3", source: "client_answer", source_ref: null },
    { id: "inc4", source: "client_answer", source_ref: null },
    { id: "totalIncome", source: "computed", source_ref: { op: "sum", inputs: ["inc1", "inc2", "inc3", "inc4"] } },
    { id: "exp1", source: "client_answer", source_ref: null },
    { id: "exp2", source: "client_answer", source_ref: null },
    { id: "totalExpenses", source: "computed", source_ref: { op: "sum", inputs: ["exp1", "exp2"] } },
    // Part 3 copies reference the (computed) totals — dependency on another computed.
    { id: "p3Income", source: "computed", source_ref: { op: "sum", inputs: ["totalIncome"] } },
    { id: "p3Expenses", source: "computed", source_ref: { op: "sum", inputs: ["totalExpenses"] } },
    { id: "net", source: "computed", source_ref: { op: "subtract", inputs: ["totalIncome", "totalExpenses"] } },
  ];

  it("sums income and expenses and computes a negative net", () => {
    // income 1400 vs expenses 1900 → net −500 (the guide's worked example).
    const answers = {
      inc1: "1400", inc2: "0", inc3: "0", inc4: "0",
      exp1: "950", exp2: "950",
    };
    const out = resolveComputedValues(questions, answers);
    expect(out.totalIncome).toBe("1,400.00");
    expect(out.totalExpenses).toBe("1,900.00");
    expect(out.p3Income).toBe("1,400.00");
    expect(out.p3Expenses).toBe("1,900.00");
    expect(out.net).toBe("-500.00");
  });

  it("defaults empty line items to 0.00 (no blank total box)", () => {
    const out = resolveComputedValues(questions, {});
    expect(out.totalIncome).toBe("0.00");
    expect(out.net).toBe("0.00");
  });

  it("only returns computed questions", () => {
    const out = resolveComputedValues(questions, { inc1: "10" });
    expect(Object.keys(out).sort()).toEqual(
      ["net", "p3Expenses", "p3Income", "totalExpenses", "totalIncome"].sort(),
    );
  });

  it("returns {} when there are no computed questions", () => {
    expect(resolveComputedValues([{ id: "a", source: "client_answer", source_ref: null }], {})).toEqual({});
  });

  it("breaks a dependency cycle without looping (treats re-entry as 0)", () => {
    const cyclic: ComputedQuestionLike[] = [
      { id: "x", source: "computed", source_ref: { op: "sum", inputs: ["y"] } },
      { id: "y", source: "computed", source_ref: { op: "sum", inputs: ["x"] } },
    ];
    const out = resolveComputedValues(cyclic, {});
    expect(out.x).toBe("0.00");
    expect(out.y).toBe("0.00");
  });

  it("sums exactly in integer cents (no float drift over many terms)", () => {
    // 0.10 × 10 = 1.00 exactly (a naive float sum would land at 0.9999999999999999).
    const dimes: ComputedQuestionLike[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, source: "client_answer", source_ref: null })),
      { id: "total", source: "computed", source_ref: { op: "sum", inputs: Array.from({ length: 10 }, (_, i) => `d${i}`) } },
    ];
    const answers = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`d${i}`, "0.10"]));
    expect(resolveComputedValues(dimes, answers).total).toBe("1.00");
  });
});

describe("findComputedCycle", () => {
  const q = (id: string, inputs: string[]): ComputedQuestionLike => ({
    id, source: "computed", source_ref: { op: "sum", inputs },
  });

  it("returns null for an acyclic graph (EOIR-26A shape)", () => {
    const ok: ComputedQuestionLike[] = [
      { id: "a", source: "client_answer", source_ref: null },
      q("t1", ["a"]),
      q("t2", ["t1"]),
    ];
    expect(findComputedCycle(ok)).toBeNull();
  });

  it("detects a direct self-reference", () => {
    expect(findComputedCycle([q("x", ["x"])])).toEqual(["x", "x"]);
  });

  it("detects a multi-hop cycle A→B→A", () => {
    const cycle = findComputedCycle([q("a", ["b"]), q("b", ["a"])]);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain("a");
    expect(cycle).toContain("b");
  });
});
