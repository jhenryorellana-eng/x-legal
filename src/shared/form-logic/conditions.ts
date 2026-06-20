/**
 * Conditional / dynamic form fields — shared primitive (boundaries: lives in
 * `shared/` so the client wizard AND the server validation/PDF-fill can both
 * evaluate the same logic). Generalizes v1's `dependsOn` (asylum M1–M11 schema):
 * a question can show/lock/require itself depending on another question's answer.
 *
 * A `condition` reads: "this question is ACTIVE when `when` holds". The `action`
 * decides what happens when it is NOT active:
 *   - show    → hidden (not rendered, not required, value cleared)
 *   - lock    → visible but disabled, with `lock_message_i18n`, not required
 *   - require → always visible/enabled, but required ONLY when active
 *
 * Overflow (e.g. the 5th child on I-589) is modeled as a normal question whose
 * condition is `{ when: { question: <#children>, op: 'gte', value: 5 }, action:'show' }`
 * mapped to the form's own continuation slots — no special repeater engine.
 */

import { z } from "zod";
import type { I18nLabel } from "@/shared/i18n";

export const CONDITION_OPS = ["equals", "not_equals", "includes", "answered", "gte", "lte"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const CONDITION_ACTIONS = ["show", "lock", "require"] as const;
export type ConditionAction = (typeof CONDITION_ACTIONS)[number];

/** Partial `{es,en}` label — matches the `*_i18n` jsonb convention. */
const I18nLabelSchema = z.object({ es: z.string(), en: z.string() }).partial();

export const ConditionWhenSchema = z.object({
  /** Controlling question — its `id` (persisted) or AI-propose `key` (pre-materialization). */
  question: z.string().min(1),
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
});
export type ConditionWhen = z.infer<typeof ConditionWhenSchema>;

export const ConditionSchema = z.object({
  when: ConditionWhenSchema,
  action: z.enum(CONDITION_ACTIONS),
  lock_message_i18n: I18nLabelSchema.nullish(),
});
export type QuestionCondition = z.infer<typeof ConditionSchema>;

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function sameScalar(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null) return false;
  // String() coercion is intentional and internally consistent: a checkbox answers
  // boolean true/false, so a catalog condition with value:"true" matches `true`.
  return String(a) === String(b);
}

/**
 * Evaluates a `when` clause against the current answers (keyed by question id).
 * A null/undefined clause means "no condition" → always satisfied.
 */
export function isConditionSatisfied(
  when: ConditionWhen | null | undefined,
  answers: Record<string, unknown>,
): boolean {
  if (!when) return true;
  const actual = answers[when.question];

  switch (when.op) {
    case "answered":
      return !isEmpty(actual);
    case "equals":
      return sameScalar(actual, when.value);
    case "not_equals":
      // An unanswered field does not (yet) satisfy a not_equals — avoids flashing
      // dependent fields before the controlling question is touched.
      return !isEmpty(actual) && !sameScalar(actual, when.value);
    case "includes": {
      if (when.value == null) return false; // no needle → never matches (avoids "undefined")
      const needles = (Array.isArray(when.value) ? when.value : [when.value]).map(String);
      if (Array.isArray(actual)) {
        const have = actual.map(String);
        return needles.some((n) => have.includes(n));
      }
      return needles.some((n) => String(actual ?? "") === n);
    }
    case "gte": {
      const a = Number(actual);
      const b = Number(when.value);
      return !Number.isNaN(a) && !Number.isNaN(b) && a >= b;
    }
    case "lte": {
      const a = Number(actual);
      const b = Number(when.value);
      return !Number.isNaN(a) && !Number.isNaN(b) && a <= b;
    }
    default:
      // Unknown op (unreachable — Zod rejects it) → treat as unsatisfied, not shown.
      return false;
  }
}

export interface FieldConditionState {
  /** Render the field? (false → not shown, not validated, value cleared). */
  visible: boolean;
  /** Visible but non-editable (lock action, condition not met). */
  disabled: boolean;
  /** Effective required flag after applying the condition. */
  required: boolean;
  /** Message to show next to a locked field (or null). */
  lockMessage: I18nLabel | null;
}

/**
 * Derives the runtime UI/validation state of a question given its condition,
 * its base `is_required`, and the current answers. The single source of truth
 * shared by the wizard, the server validator, and the PDF filler.
 */
export function deriveFieldState(
  condition: QuestionCondition | null | undefined,
  baseRequired: boolean,
  answers: Record<string, unknown>,
): FieldConditionState {
  if (!condition) {
    return { visible: true, disabled: false, required: baseRequired, lockMessage: null };
  }
  const active = isConditionSatisfied(condition.when, answers);

  switch (condition.action) {
    case "show":
      return { visible: active, disabled: false, required: active && baseRequired, lockMessage: null };
    case "lock":
      return {
        visible: true,
        disabled: !active,
        required: active && baseRequired,
        lockMessage: !active ? (condition.lock_message_i18n ?? null) : null,
      };
    case "require":
      return { visible: true, disabled: false, required: active, lockMessage: null };
    default:
      return { visible: true, disabled: false, required: baseRequired, lockMessage: null };
  }
}

/** Narrowing parse helper — returns a typed condition or null for invalid/empty input. */
export function parseConditionOrNull(raw: unknown): QuestionCondition | null {
  if (raw == null) return null;
  const r = ConditionSchema.safeParse(raw);
  return r.success ? r.data : null;
}
