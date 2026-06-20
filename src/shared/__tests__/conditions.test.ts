import { describe, it, expect } from "vitest";
import {
  isConditionSatisfied,
  deriveFieldState,
  ConditionSchema,
  type QuestionCondition,
} from "@/shared/form-logic/conditions";

describe("isConditionSatisfied", () => {
  it("equals / not_equals on a Sí/No select", () => {
    expect(isConditionSatisfied({ question: "yn", op: "equals", value: "si" }, { yn: "si" })).toBe(true);
    expect(isConditionSatisfied({ question: "yn", op: "equals", value: "si" }, { yn: "no" })).toBe(false);
    expect(isConditionSatisfied({ question: "yn", op: "not_equals", value: "no" }, { yn: "si" })).toBe(true);
  });

  it("equals on a checkbox boolean", () => {
    expect(isConditionSatisfied({ question: "chk", op: "equals", value: true }, { chk: true })).toBe(true);
    expect(isConditionSatisfied({ question: "chk", op: "equals", value: true }, { chk: false })).toBe(false);
  });

  it("includes on a multi-checkbox array", () => {
    expect(
      isConditionSatisfied({ question: "g", op: "includes", value: "political_opinion" }, { g: ["race", "political_opinion"] }),
    ).toBe(true);
    expect(
      isConditionSatisfied({ question: "g", op: "includes", value: ["psg", "political_opinion"] }, { g: ["race"] }),
    ).toBe(false);
  });

  it("includes with no value never matches (does not coerce undefined to a needle)", () => {
    expect(isConditionSatisfied({ question: "g", op: "includes" }, { g: ["undefined"] })).toBe(false);
    expect(isConditionSatisfied({ question: "g", op: "includes" }, { g: ["race"] })).toBe(false);
  });

  it("answered checks non-empty", () => {
    expect(isConditionSatisfied({ question: "q", op: "answered" }, { q: "x" })).toBe(true);
    expect(isConditionSatisfied({ question: "q", op: "answered" }, { q: "" })).toBe(false);
    expect(isConditionSatisfied({ question: "q", op: "answered" }, { q: [] })).toBe(false);
    expect(isConditionSatisfied({ question: "q", op: "answered" }, {})).toBe(false);
  });

  it("gte / lte (number of children → overflow)", () => {
    expect(isConditionSatisfied({ question: "n", op: "gte", value: 5 }, { n: 5 })).toBe(true);
    expect(isConditionSatisfied({ question: "n", op: "gte", value: 5 }, { n: "6" })).toBe(true);
    expect(isConditionSatisfied({ question: "n", op: "gte", value: 5 }, { n: 4 })).toBe(false);
    expect(isConditionSatisfied({ question: "n", op: "lte", value: 2 }, { n: 1 })).toBe(true);
  });

  it("missing controlling answer is unsatisfied (non-answered ops)", () => {
    expect(isConditionSatisfied({ question: "yn", op: "equals", value: "si" }, {})).toBe(false);
    expect(isConditionSatisfied({ question: "n", op: "gte", value: 5 }, {})).toBe(false);
  });

  it("null/undefined when → satisfied (no condition)", () => {
    expect(isConditionSatisfied(null, {})).toBe(true);
    expect(isConditionSatisfied(undefined, {})).toBe(true);
  });
});

describe("deriveFieldState", () => {
  const yes = { yn: "si" };
  const no = { yn: "no" };
  const showIfYes: QuestionCondition = { when: { question: "yn", op: "equals", value: "si" }, action: "show" };

  it("no condition → visible, required follows base", () => {
    expect(deriveFieldState(null, true, {})).toEqual({ visible: true, disabled: false, required: true, lockMessage: null });
  });

  it("show: hidden + not required when condition is false", () => {
    expect(deriveFieldState(showIfYes, true, no)).toEqual({ visible: false, disabled: false, required: false, lockMessage: null });
    expect(deriveFieldState(showIfYes, true, yes)).toEqual({ visible: true, disabled: false, required: true, lockMessage: null });
  });

  it("lock: visible-but-disabled + message when condition is false", () => {
    const c: QuestionCondition = {
      when: { question: "yn", op: "equals", value: "si" },
      action: "lock",
      lock_message_i18n: { es: "Responde Sí arriba para habilitar.", en: "Answer Yes above to enable." },
    };
    const off = deriveFieldState(c, true, no);
    expect(off.visible).toBe(true);
    expect(off.disabled).toBe(true);
    expect(off.required).toBe(false);
    expect(off.lockMessage).toEqual({ es: "Responde Sí arriba para habilitar.", en: "Answer Yes above to enable." });
    const on = deriveFieldState(c, true, yes);
    expect(on.disabled).toBe(false);
    expect(on.lockMessage).toBeNull();
  });

  it("require: required only when condition is true", () => {
    const c: QuestionCondition = { when: { question: "yn", op: "equals", value: "si" }, action: "require" };
    expect(deriveFieldState(c, false, yes).required).toBe(true);
    expect(deriveFieldState(c, false, no).required).toBe(false);
  });
});

describe("ConditionSchema", () => {
  it("parses a valid condition", () => {
    const parsed = ConditionSchema.parse({ when: { question: "q1", op: "equals", value: "si" }, action: "show" });
    expect(parsed.action).toBe("show");
    expect(parsed.when.op).toBe("equals");
  });

  it("rejects an unknown op or action", () => {
    expect(() => ConditionSchema.parse({ when: { question: "q1", op: "weird", value: "x" }, action: "show" })).toThrow();
    expect(() => ConditionSchema.parse({ when: { question: "q1", op: "equals", value: "x" }, action: "delete" })).toThrow();
  });
});
