/**
 * Unit tests for the FormWizard pure validation engine (DOC-50 §12 — "lógica
 * extraíble (buildQuestionSchema) … se diseñan exportables para testearse").
 *
 * These mirror the server `validateAnswerTypes` semantics: the wizard never
 * trusts the local pass, but the codes/short-circuit order must stay aligned.
 */
import { describe, it, expect } from "vitest";
import {
  validateQuestion,
  validateGroup,
  firstInvalidGroupIndex,
  buildQuestionSchema,
} from "../build-question-schema";
import type { WizardQuestion } from "../types";

function q(partial: Partial<WizardQuestion>): WizardQuestion {
  return {
    id: "q",
    groupId: "g",
    questionI18n: { en: "Q", es: "P" },
    helpI18n: null,
    fieldType: "text",
    options: null,
    isRequired: false,
    position: 0,
    source: "client_answer",
    validation: null,
    prefillValue: null,
    isPrefilled: false,
    currentAnswer: null,
    ...partial,
  };
}

describe("validateQuestion", () => {
  it("flags required empty as 'required'", () => {
    expect(validateQuestion(q({ isRequired: true }), "")).toEqual({ ok: false, code: "required" });
    expect(validateQuestion(q({ isRequired: true }), null)).toEqual({ ok: false, code: "required" });
  });

  it("accepts optional empty", () => {
    expect(validateQuestion(q({ isRequired: false }), "")).toEqual({ ok: true });
  });

  it("requires a checked checkbox when required", () => {
    expect(validateQuestion(q({ fieldType: "checkbox", isRequired: true }), false)).toEqual({
      ok: false,
      code: "required",
    });
    expect(validateQuestion(q({ fieldType: "checkbox", isRequired: true }), true)).toEqual({ ok: true });
  });

  it("enforces regex on strings", () => {
    const rule = q({ validation: { regex: "^[0-9]{5}$" } });
    expect(validateQuestion(rule, "12345")).toEqual({ ok: true });
    expect(validateQuestion(rule, "abc")).toEqual({ ok: false, code: "regex" });
  });

  it("enforces min/max as numeric for number fields", () => {
    const rule = q({ fieldType: "number", validation: { min: 0, max: 30 } });
    expect(validateQuestion(rule, "5")).toEqual({ ok: true });
    expect(validateQuestion(rule, "-1")).toEqual({ ok: false, code: "min" });
    expect(validateQuestion(rule, "31")).toEqual({ ok: false, code: "max" });
  });

  it("enforces min/max as string length for text fields", () => {
    const rule = q({ validation: { min: 3, max: 5 } });
    expect(validateQuestion(rule, "ab")).toEqual({ ok: false, code: "min" });
    expect(validateQuestion(rule, "abcdef")).toEqual({ ok: false, code: "max" });
    expect(validateQuestion(rule, "abcd")).toEqual({ ok: true });
  });

  it("ignores an invalid catalog regex silently", () => {
    const rule = q({ validation: { regex: "([" } });
    expect(validateQuestion(rule, "anything")).toEqual({ ok: true });
  });
});

describe("validateGroup + firstInvalidGroupIndex", () => {
  it("collects per-question errors", () => {
    const questions = [q({ id: "a", isRequired: true }), q({ id: "b" })];
    const res = validateGroup(questions, { a: "", b: "ok" });
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual({ a: "required" });
  });

  it("finds the first invalid group", () => {
    const groups = [
      { questions: [q({ id: "a" })] },
      { questions: [q({ id: "b", isRequired: true })] },
    ];
    expect(firstInvalidGroupIndex(groups, { a: "x", b: "" })).toBe(1);
    expect(firstInvalidGroupIndex(groups, { a: "x", b: "y" })).toBe(-1);
  });

  it("skips a required field hidden by its condition (show)", () => {
    // explanation is required, but only visible when yn === 'si'
    const questions = [
      q({ id: "yn", fieldType: "select", options: [{ value: "si", labelI18n: { en: "Yes", es: "Sí" } }, { value: "no", labelI18n: { en: "No", es: "No" } }] }),
      q({
        id: "explanation",
        isRequired: true,
        fieldType: "textarea",
        condition: { when: { question: "yn", op: "equals", value: "si" }, action: "show" },
      }),
    ];
    // yn = no → explanation hidden → group valid even though it's empty
    expect(validateGroup(questions, { yn: "no", explanation: "" }).ok).toBe(true);
    // yn = si → explanation visible + required + empty → invalid
    const res = validateGroup(questions, { yn: "si", explanation: "" });
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual({ explanation: "required" });
    // yn = si + filled → valid
    expect(validateGroup(questions, { yn: "si", explanation: "porque..." }).ok).toBe(true);
  });

  it("does not require a field locked off by its condition (lock)", () => {
    const questions = [
      q({ id: "yn", fieldType: "select" }),
      q({
        id: "detail",
        isRequired: true,
        condition: { when: { question: "yn", op: "equals", value: "si" }, action: "lock" },
      }),
    ];
    // locked (yn !== si) → not required
    expect(validateGroup(questions, { yn: "no", detail: "" }).ok).toBe(true);
    // unlocked + empty required → invalid
    expect(validateGroup(questions, { yn: "si", detail: "" }).ok).toBe(false);
  });
});

describe("buildQuestionSchema (Zod generation, DOC-50 §6.2)", () => {
  it("generates a required string schema", () => {
    const schema = buildQuestionSchema(q({ isRequired: true }));
    expect(schema.safeParse("").success).toBe(false);
    expect(schema.safeParse("hello").success).toBe(true);
  });

  it("generates a number schema with bounds", () => {
    const schema = buildQuestionSchema(q({ fieldType: "number", validation: { min: 1, max: 10 } }));
    expect(schema.safeParse("5").success).toBe(true);
    expect(schema.safeParse("11").success).toBe(false);
    expect(schema.safeParse("0").success).toBe(false);
  });

  it("generates a checkbox literal(true) schema when required", () => {
    const schema = buildQuestionSchema(q({ fieldType: "checkbox", isRequired: true }));
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse(false).success).toBe(false);
  });

  it("carries the validation code in the issue message", () => {
    const schema = buildQuestionSchema(q({ isRequired: true }));
    const res = schema.safeParse("");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].message).toBe("required");
    }
  });
});
