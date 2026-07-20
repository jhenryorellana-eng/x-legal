/**
 * Computed / derived form fields — shared primitive (lives in `shared/` so the
 * client wizard, the admin preview AND the authoritative server PDF-fill all
 * evaluate the SAME arithmetic). Companion to `conditions.ts` / `empty-policy.ts`
 * / `ai-field-format.ts`.
 *
 * WHY THIS EXISTS. Some official forms print TOTAL boxes whose value is a fixed
 * arithmetic function of other boxes — the client never types them, they are
 * derived. The first case is the EOIR-26A (Fee Waiver Request):
 *   - Part 1 · 1.A  = SUM of the four monthly-income line items.
 *   - Part 2 · 2.B  = SUM of the five monthly-expense line items.
 *   - Part 3 · TOTAL = 1.A − 2.B  (may be NEGATIVE — a negative "left over" is in
 *                       fact the strongest argument for the waiver).
 *
 * Three properties make this a first-class `source`, not a client_answer or an
 * ai_field:
 *   1. DETERMINISTIC — money math must be exact. An LLM (`ai_field`) is the wrong
 *      tool: "an error = the case is denied" (Henry). This is plain code.
 *   2. NO BLANK BOXES — a fee-waiver form is rejected if any box is blank
 *      (8 CFR §1003.8). A computed total always yields a value (0.00 when every
 *      operand is empty), so the total box is never left empty.
 *   3. NEGATIVES ALLOWED — unlike a raw count, income − expenses is meaningfully
 *      negative and must render as such.
 *
 * BOUNDARIES: pure functions, no I/O. The stored `form_questions.source_ref` for a
 * computed question is the inner object `{ op, inputs }` (matching how every other
 * source stores its inner ref). `inputs` are the ids of the operand questions —
 * either plain `client_answer` numbers OR other computed questions (Part 3 copies
 * 1.A / 2.B, which are themselves computed): `resolveComputedValues` resolves them
 * in dependency order.
 */

import { z } from "zod";

export const COMPUTED_OPS = ["sum", "subtract"] as const;
export type ComputedOp = (typeof COMPUTED_OPS)[number];

/**
 * The inner `source_ref` of a `computed` question.
 *  - `sum`      → inputs[0] + inputs[1] + … (the 1.A / 2.B totals).
 *  - `subtract` → inputs[0] − (inputs[1] + … + inputs[n]) (the Part 3 TOTAL =
 *                 income − expenses). A single input makes it a passthrough/copy.
 */
export const ComputedSourceRefSchema = z.object({
  op: z.enum(COMPUTED_OPS),
  inputs: z.array(z.string().min(1)).min(1).max(50),
});
export type ComputedSourceRef = z.infer<typeof ComputedSourceRefSchema>;

/** Narrowing parse helper — a typed ref or null for invalid/empty input. */
export function parseComputedSourceRef(raw: unknown): ComputedSourceRef | null {
  if (raw == null) return null;
  const r = ComputedSourceRefSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * Tolerant money → number. Accepts what a real person types into a currency box:
 * "$1,400.00", " 300 ", "1,234.5", a bare `number`. Accounting negatives "(500)"
 * become −500. Anything unparseable (blank, "N/A", garbage) resolves to 0 — never
 * NaN, so a blank line item contributes 0 to its total instead of poisoning it.
 */
export function parseMoneyNumber(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== "string") return 0;
  let s = raw.trim();
  if (s === "") return 0;
  // Accounting negative: "(500)" → −500 (before we strip the parentheses below).
  let sign = 1;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) {
    sign = -1;
    s = paren[1];
  }
  // Keep only digits, a decimal point and a leading minus; drop $, commas, spaces.
  s = s.replace(/[^0-9.-]/g, "");
  if (s === "" || s === "-" || s === ".") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : 0;
}

/**
 * Number → the string stamped on the PDF. Fixed 2 decimals, thousands separators,
 * negative as a leading "-". No "$" symbol: EOIR money boxes print the sign/label
 * outside the field, and the per-line client entries are written as typed — the
 * exact glyph set is re-verified against a real mupdf render before publishing
 * (this is the single place to change it if the box wants "$" or a different form).
 */
export function formatComputedResult(n: number): string {
  // Round to cents first so binary FP (0.1 + 0.2) can't leak a 2.9999 into toFixed.
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  const neg = rounded < 0;
  const [intPart, decPart] = Math.abs(rounded).toFixed(2).split(".");
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${withThousands}.${decPart}`;
}

/** Minimal shape a question needs for computed resolution. */
export interface ComputedQuestionLike {
  id: string;
  source: string;
  source_ref: unknown;
}

/**
 * Resolves EVERY computed question in a form to its formatted string value, keyed
 * by question id. Operands are read from `answers` (client line items) or, when an
 * operand is itself a computed question, resolved recursively — so Part 3 (which
 * references the 1.A / 2.B totals) resolves correctly regardless of question order.
 *
 * A dependency cycle (config error) is broken by treating the re-entered node as 0,
 * so this can never loop. Non-computed questions are absent from the result.
 */
export function resolveComputedValues(
  questions: ComputedQuestionLike[],
  answers: Record<string, unknown>,
): Record<string, string> {
  const computedById = new Map<string, ComputedSourceRef>();
  for (const q of questions) {
    if (q.source !== "computed") continue;
    const ref = parseComputedSourceRef(q.source_ref);
    if (ref) computedById.set(q.id, ref);
  }
  if (computedById.size === 0) return {};

  // Arithmetic is done in INTEGER CENTS, not floating dollars: money math must be
  // exact ("an error = the case is denied"), and integer sums have no drift. Each
  // client operand is rounded to the nearest cent once, then everything is summed as
  // integers; only the final format divides by 100.
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const evalCents = (id: string): number => {
    const ref = computedById.get(id);
    if (!ref) return Math.round(parseMoneyNumber(answers[id]) * 100); // client_answer operand → cents
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard — a mis-configured self/mutual reference
    visiting.add(id);
    const parts = ref.inputs.map(evalCents);
    let result: number;
    if (ref.op === "sum") {
      result = parts.reduce((a, b) => a + b, 0);
    } else {
      // subtract: first operand minus the sum of the rest (income − expenses).
      const [first = 0, ...rest] = parts;
      result = first - rest.reduce((a, b) => a + b, 0);
    }
    visiting.delete(id);
    memo.set(id, result);
    return result;
  };

  const out: Record<string, string> = {};
  for (const id of computedById.keys()) out[id] = formatComputedResult(evalCents(id) / 100);
  return out;
}

/**
 * Detects a dependency CYCLE among computed questions (a direct self-reference OR a
 * multi-hop A→B→A). Returns the ids on the first cycle found (in order), or null if
 * the computed sub-graph is acyclic. validateVersionPublication calls this at publish
 * time: the runtime `visiting` guard already prevents an infinite loop, but a
 * multi-hop cycle would otherwise publish cleanly and only surface as several
 * unexplained $0.00 totals in the live PDF. Catch it before it ships.
 */
export function findComputedCycle(questions: ComputedQuestionLike[]): string[] | null {
  const deps = new Map<string, string[]>();
  for (const q of questions) {
    if (q.source !== "computed") continue;
    const ref = parseComputedSourceRef(q.source_ref);
    if (ref) deps.set(q.id, ref.inputs);
  }
  const state = new Map<string, 1 | 2>(); // 1 = on the current DFS stack, 2 = fully explored
  const stack: string[] = [];
  const dfs = (id: string): string[] | null => {
    if (!deps.has(id)) return null; // a non-computed operand (leaf) — cannot start a cycle
    const s = state.get(id);
    if (s === 1) return [...stack.slice(stack.indexOf(id)), id]; // back-edge → cycle
    if (s === 2) return null;
    state.set(id, 1);
    stack.push(id);
    for (const dep of deps.get(id)!) {
      const cycle = dfs(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of deps.keys()) {
    const cycle = dfs(id);
    if (cycle) return cycle;
  }
  return null;
}
