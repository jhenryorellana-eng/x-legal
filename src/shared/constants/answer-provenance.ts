/**
 * Provenance of a single questionnaire answer — WHO (or what) authored it.
 *
 * Why this exists: `draft_answers` used to be a flat jsonb of strings, so nothing
 * downstream could tell a grounded AI draft apart from a fabricated filler. The
 * completeness gate counted both as "answered", which is how case U26-000038
 * reached `approved` with 36% real testimony and generated an appeal brief on top
 * of 15 sentences that said, in the client's own voice, that she had no information.
 *
 * Provenance is a STATE MACHINE, not a label. The ordering below is a strict
 * precedence: `mergeProvenance` keeps the strongest state, so a human touch always
 * wins and is terminal — a regeneration can never demote a client-authored answer
 * back to an AI one.
 *
 * `ai_gap_filled` is READ-ONLY history: it exists to classify pre-migration rows
 * and the filler that is being removed. No new producer may write it — the
 * legitimate successor is a `negative_option` validated against the question's real
 * options (see filterDraftAnswers), which lands as `ai_grounded`.
 */

export const ANSWER_PROVENANCES = [
  /** The client typed (or dictated) this answer. */
  "client_edited",
  /** The client accepted a prefill taken from the record with a single tap. */
  "client_confirmed",
  /** AI drafted it from evidence actually present in the case file. */
  "ai_grounded",
  /** Resolved deterministically from a document/profile/generation source (no LLM). */
  "source_resolved",
  /** The question schema carried a default_value. */
  "schema_default",
  /** LEGACY/READ-ONLY: AI filler for a question the record could not answer. */
  "ai_gap_filled",
  /** Pre-migration rows: we do not know, and we refuse to guess. */
  "unknown",
] as const;

export type AnswerProvenance = (typeof ANSWER_PROVENANCES)[number];

/** Strict precedence — LOWER wins a merge. Order mirrors ANSWER_PROVENANCES. */
const PRECEDENCE: Record<AnswerProvenance, number> = {
  client_edited: 0,
  client_confirmed: 1,
  ai_grounded: 2,
  source_resolved: 3,
  schema_default: 4,
  ai_gap_filled: 5,
  unknown: 6,
};

/**
 * States that count as a real answer for the completeness gate.
 *
 * `ai_gap_filled` and `unknown` are deliberately absent: that exclusion IS the
 * fix. A questionnaire may no longer close because the AI wrote "Por ahora no
 * cuento con información" on the client's behalf.
 */
const ANSWERED: ReadonlySet<AnswerProvenance> = new Set<AnswerProvenance>([
  "client_edited",
  "client_confirmed",
  "ai_grounded",
  "source_resolved",
  "schema_default",
]);

const CLIENT_AUTHORED: ReadonlySet<AnswerProvenance> = new Set<AnswerProvenance>([
  "client_edited",
  "client_confirmed",
]);

export function isAnswerProvenance(value: unknown): value is AnswerProvenance {
  return typeof value === "string" && (ANSWER_PROVENANCES as readonly string[]).includes(value);
}

/** True when a human — not the machine — is responsible for the wording. */
export function isClientAuthored(p: AnswerProvenance): boolean {
  return CLIENT_AUTHORED.has(p);
}

/** The completeness-gate contract. See ANSWERED for why filler is excluded. */
export function countsAsAnswered(p: AnswerProvenance): boolean {
  return ANSWERED.has(p);
}

/**
 * Combines the stored provenance with an incoming one, keeping the stronger.
 * Human input is terminal: `client_*` never reverts to `ai_*`, so regenerating a
 * questionnaire cannot erase the fact that the client authored an answer.
 */
export function mergeProvenance(current: AnswerProvenance, next: AnswerProvenance): AnswerProvenance {
  return PRECEDENCE[next] < PRECEDENCE[current] ? next : current;
}

export interface AnswerCoverage {
  total: number;
  /** Answers that count for the gate (see countsAsAnswered). */
  answered: number;
  /** Subset of `answered` actually authored by the client. */
  clientAuthored: number;
  /** Legacy filler still present — the number to drive to zero. */
  gapFilled: number;
  /** answered / total, rounded to a whole percent. 0 for an empty map. */
  pct: number;
}

/**
 * Input-coverage summary. This is what the Pre-Mortem must see (and what the
 * staff review screen shows above the score): a brief written over 40% coverage
 * is not a prose-quality problem, it is an input-starvation problem.
 */
export function coverageOf(map: Record<string, AnswerProvenance>): AnswerCoverage {
  const values = Object.values(map);
  const total = values.length;
  let answered = 0;
  let clientAuthored = 0;
  let gapFilled = 0;
  for (const p of values) {
    if (countsAsAnswered(p)) answered++;
    if (isClientAuthored(p)) clientAuthored++;
    if (p === "ai_gap_filled") gapFilled++;
  }
  return {
    total,
    answered,
    clientAuthored,
    gapFilled,
    pct: total === 0 ? 0 : Math.round((answered / total) * 100),
  };
}

/**
 * Reads a provenance jsonb column defensively. Anything unrecognised becomes
 * `unknown` rather than being dropped — losing the key would silently shrink the
 * coverage denominator and make a starved questionnaire look complete.
 */
export function parseProvenanceMap(raw: unknown): Record<string, AnswerProvenance> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, AnswerProvenance> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = isAnswerProvenance(value) ? value : "unknown";
  }
  return out;
}
