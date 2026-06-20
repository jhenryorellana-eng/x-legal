/**
 * buildQuestionSchema — generates a Zod schema PER QUESTION from the jsonb
 * (DOC-50 §6.2). Pure function, exported for unit testing (DOC-50 §12).
 *
 * IMPORTANT: this is UX courtesy only. The validation that COUNTS runs
 * server-side in `cases.submitFormResponse` (`validateAnswerTypes`, DOC-41).
 * The codes here mirror the server domain (`required`/`regex`/`min`/`max`/`type`)
 * so the inline messages stay consistent, but passing the local Zod NEVER implies
 * server acceptance.
 *
 * Semantics intentionally match `backend/modules/cases/domain.ts → validateAnswerTypes`:
 *  - empty + required → "required"
 *  - empty + optional → valid (skip rule checks)
 *  - regex: applies to string values
 *  - min/max: numeric comparison if the value is a number; otherwise string LENGTH
 */

import { z } from "zod";
import { deriveFieldState } from "@/shared/form-logic/conditions";
import type { WizardQuestion, FieldErrorCode } from "./types";

/**
 * buildQuestionSchema — GENERATES a Zod schema for a single question from
 * `is_required` + the `validation` jsonb + `field_type` (DOC-50 §6.2 verbatim).
 *
 * Returned schema accepts the raw answer value (string for text/textarea/date,
 * string or number for number, boolean for checkbox, string for select). The
 * error codes are carried in `params.code` so the UI can resolve an amable i18n
 * message. The step schema is the `z.object` of its questions (see `buildGroupSchema`).
 */
export function buildQuestionSchema(question: WizardQuestion): z.ZodTypeAny {
  const v = question.validation;
  const required = question.isRequired;

  // checkbox → boolean (required means it must be true)
  if (question.fieldType === "checkbox") {
    let s: z.ZodTypeAny = z.boolean();
    if (required) {
      s = z.literal(true, { message: "required" });
    } else {
      s = z.boolean().optional();
    }
    return s;
  }

  // number → coerced number with optional min/max
  if (question.fieldType === "number") {
    let n = z.coerce.number({ message: "type" });
    if (v?.min !== undefined) n = n.min(v.min, { message: "min" });
    if (v?.max !== undefined) n = n.max(v.max, { message: "max" });
    if (required) {
      // empty string fails coercion → surface as required
      return z.preprocess(
        (val) => (val === "" || val === null || val === undefined ? undefined : val),
        n,
      ).refine((val) => val !== undefined, { message: "required" });
    }
    return z.preprocess(
      (val) => (val === "" || val === null || val === undefined ? undefined : val),
      n.optional(),
    );
  }

  // select → value must be one of the declared options (mirrors the server-side
  // whitelist in validateAnswerTypes; UX courtesy, server remains the source of truth)
  if (question.fieldType === "select" && question.options && question.options.length > 0) {
    const values = question.options.map((o) => o.value) as [string, ...string[]];
    const sel = z.enum(values, { message: "type" });
    return required ? sel : sel.optional().or(z.literal(""));
  }

  // text / textarea / date → string with optional regex + min/max length
  let s = z.string();
  if (v?.regex) {
    try {
      s = s.regex(new RegExp(v.regex), { message: "regex" });
    } catch {
      /* invalid catalog regex — skip */
    }
  }
  if (v?.min !== undefined && question.fieldType !== "date") {
    s = s.min(v.min, { message: "min" });
  }
  if (v?.max !== undefined && question.fieldType !== "date") {
    s = s.max(v.max, { message: "max" });
  }
  if (required) {
    return s.min(1, { message: "required" });
  }
  return s.optional().or(z.literal(""));
}

/** The step (group) schema = a z.object of its question schemas, keyed by id. */
export function buildGroupSchema(questions: WizardQuestion[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const q of questions) {
    shape[q.id] = buildQuestionSchema(q);
  }
  return z.object(shape);
}


export interface FieldValidationResult {
  ok: boolean;
  code?: FieldErrorCode;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Validates a single answer against the question rules. Mirrors the server
 * `validateAnswerTypes` loop exactly (same short-circuit order).
 */
export function validateQuestion(question: WizardQuestion, value: unknown): FieldValidationResult {
  const empty = isEmpty(value);

  if (question.isRequired && empty) {
    return { ok: false, code: "required" };
  }
  // Checkbox required means it must be checked (true).
  if (question.isRequired && question.fieldType === "checkbox" && value !== true) {
    return { ok: false, code: "required" };
  }
  if (empty) return { ok: true }; // optional + empty → valid

  const v = question.validation;
  if (!v) return { ok: true };

  if (v.regex) {
    try {
      const re = new RegExp(v.regex);
      if (typeof value === "string" && !re.test(value)) {
        return { ok: false, code: "regex" };
      }
    } catch {
      // Invalid regex in catalog — skip silently (server does the same).
    }
  }

  if (v.min !== undefined) {
    const num = Number(value);
    if (!Number.isNaN(num) && typeof value !== "string" && num < v.min) {
      return { ok: false, code: "min" };
    }
    if (typeof value === "string") {
      // For numeric fields, compare the parsed number; otherwise compare length.
      if (question.fieldType === "number") {
        const n = Number(value);
        if (!Number.isNaN(n) && n < v.min) return { ok: false, code: "min" };
      } else if (value.length < v.min) {
        return { ok: false, code: "min" };
      }
    }
  }

  if (v.max !== undefined) {
    const num = Number(value);
    if (!Number.isNaN(num) && typeof value !== "string" && num > v.max) {
      return { ok: false, code: "max" };
    }
    if (typeof value === "string") {
      if (question.fieldType === "number") {
        const n = Number(value);
        if (!Number.isNaN(n) && n > v.max) return { ok: false, code: "max" };
      } else if (value.length > v.max) {
        return { ok: false, code: "max" };
      }
    }
  }

  return { ok: true };
}

/**
 * Validates an entire group (a wizard step). Returns the first error per
 * question (a map questionId → code) and a boolean.
 */
export interface GroupValidationResult {
  ok: boolean;
  errors: Record<string, FieldErrorCode>;
}

export function validateGroup(
  questions: WizardQuestion[],
  answers: Record<string, unknown>,
): GroupValidationResult {
  const errors: Record<string, FieldErrorCode> = {};
  for (const q of questions) {
    // A field hidden by its condition is not rendered and not validated; a
    // condition can also flip `required` on/off (mirrors the server validator).
    const st = deriveFieldState(q.condition, q.isRequired, answers);
    if (!st.visible) continue;
    const res = validateQuestion({ ...q, isRequired: st.required }, answers[q.id]);
    if (!res.ok && res.code) errors[q.id] = res.code;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Returns the index of the first group that has any validation error, or -1 if
 * every group is valid. Used on "Terminar" to jump to the offending step
 * (DOC-50 §6.5 — "falta uno → salta a ese grupo señalándolo").
 */
export function firstInvalidGroupIndex(
  groups: { questions: WizardQuestion[] }[],
  answers: Record<string, unknown>,
): number {
  for (let i = 0; i < groups.length; i++) {
    if (!validateGroup(groups[i].questions, answers).ok) return i;
  }
  return -1;
}
