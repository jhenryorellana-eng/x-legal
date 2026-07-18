/**
 * ai_field output shaping — shared primitive (lives in `shared/` so the wizard
 * prefill, the durable cache and the authoritative PDF fill all render the SAME
 * text). Companion to `empty-policy.ts` / `conditions.ts`.
 *
 * WHY THIS EXISTS. An `ai_field` is free text written by a provider from a per-
 * field instruction the admin configures. Two properties of that text are NOT
 * negotiable on a federal filing, and neither can be guaranteed by prompt prose
 * alone — a model honours a format request most of the time, which is exactly the
 * failure mode that is hardest to notice:
 *
 *  1. SHAPE — EOIR-26 item #6 asks for the grounds of appeal as a list. On
 *     2026-07-18 PROD returned the eight grounds with ZERO newlines
 *     ("...(i)(1)).2. The Immigration Judge...") so the official box printed one
 *     dense run-on paragraph. The same instruction had produced a clean list the
 *     day before: the shape was luck, not a guarantee. `normalizeAiFieldText`
 *     makes it deterministic AFTER the provider answers.
 *
 *  2. SIZE — an overlong value overflows its AcroForm widget and mupdf's
 *     `bake()` silently CLIPS the excess: content loss that is invisible in the
 *     PDF. So the ceiling is declared ONCE as data (`source_ref.max_chars`,
 *     edited from the admin form editor — never hardcoded per form), injected
 *     into the prompt by `buildAiFieldInstruction`, and verified here afterwards.
 *
 * DELIBERATE NON-GOAL: this never truncates. A value over the ceiling is returned
 * whole and flagged (`overflow`); the caller logs/surfaces it. Silently cutting a
 * legal argument mid-sentence is strictly worse than a box that visibly overflows.
 *
 * SAFETY INVARIANT that bounds every heuristic below: the only edit this module
 * ever makes is INSERTING a line break (plus trimming trailing spaces / collapsing
 * blank runs). It never deletes, reorders or rewrites a character of content. So
 * the worst a misfire can do is add a cosmetic line break — never lose a ground,
 * a citation or a date from a filing.
 *
 * KNOWN LIMITATION (accepted, review 2026-07-18): the "N ascending markers = a
 * list" heuristic cannot distinguish a genuine numbered list from N coincidentally
 * ascending numbers after unrelated references, e.g.
 *   "…found at Exhibit A. 1. The case is discussed on page 12. Later, at Tab B. 2. The witness…"
 * That needs two or three independent coincidences to trigger, and by the invariant
 * above it degrades to a spurious line break, so it is left alone rather than
 * tightened at the cost of rejecting real lists.
 */

export interface AiFieldFormatOptions {
  /** Hard ceiling for the rendered value, in characters. 0 / undefined = unbounded. */
  maxChars?: number;
}

export interface AiFieldFormatResult {
  /** The shaped text. NEVER truncated — see the module note. */
  text: string;
  /** True when `text` exceeds `maxChars` (caller decides how to surface it). */
  overflow: boolean;
  /** True when a run-on numbered list was split into one line per item. */
  relisted: boolean;
}

/**
 * Candidate list markers: a `N.` token that sits INSIDE a line (never at its
 * start) and is followed by a space and a capital letter — i.e. the shape a
 * run-on list takes. The lookbehind requires the marker to follow a sentence
 * end (`.`, `)`, `:`) so mid-sentence numbers are not candidates.
 *
 * The separator class is `[ \t]*` and NOT `\s*` on purpose: a newline before the
 * marker means the list is ALREADY formatted, and such a marker must not count
 * as a candidate (otherwise a well-formed value reports `relisted: true` and the
 * blank-line collapsing below never sees its own newlines).
 *
 * The number is capped at two digits and MUST be followed by `. ` + uppercase,
 * which is what keeps legal citations intact: `Dec. 721 (BIA 1997)` has no
 * `". "` after the digits, and `1003.2(c)` / `§ 241(b)(3)` have no space either.
 */
const RUN_ON_MARKER = /(?<=[.)\]:])[ \t]*(?=(\d{1,2})\.[ \t]+\p{Lu})/gu;

/**
 * A period glued directly to a capital letter (`...Honduras.A separate...`).
 * Normal prose always puts a space after the period, so this is an unambiguous
 * lost line break. Applied ONLY once a run-on list has been detected, which
 * confines it to the exact malformed-output case.
 *
 * The lookbehind exempts INITIALISMS — a single letter preceded by a space, an
 * opening paren or another period. Without it `8 C.F.R. 1003.2(c)` is shredded
 * into `8 C.` / `F.` / `R. 1003.2(c)`, which corrupts a citation on a federal
 * filing. Caught by the real-PROD-value regression test below, not in review.
 *
 * The exemption is deliberately SINGLE-LETTER only. Multi-letter abbreviations
 * glued to the next word (`Va.The court records…`) are treated as a lost line
 * break, because real prose spaces after them. Do not widen this to multi-letter
 * tokens without new tests — that is precisely how the C.F.R.-shredding bug
 * would come back in a different shape.
 */
const GLUED_SENTENCE = /(?<![\s(.]\p{L})\.(?=\p{Lu})/gu;

/**
 * Splits a run-on numbered list into one line per item — but ONLY when the
 * markers form a strictly ascending 1..N sequence.
 *
 * That guard is what makes this safe to run over every ai_field of every form:
 * prose that merely happens to contain "… in 2019. 5. was never raised …" does
 * not form a sequence starting at 1, so it is left exactly as written. A false
 * split on a federal filing would corrupt a citation; refusing to split only
 * costs us the formatting improvement.
 */
function relistRunOnList(text: string): { text: string; relisted: boolean } {
  const markers = [...text.matchAll(RUN_ON_MARKER)];
  if (markers.length === 0) return { text, relisted: false };

  // The first item ("1.") normally already starts the text, so the in-line
  // markers we find are 2..N. Accept only a gapless ascending run.
  const numbers = markers.map((m) => Number(m[1]));
  const startsAt = numbers[0];
  const ascending = numbers.every((n, i) => n === startsAt + i);
  if (!ascending) return { text, relisted: false };

  // The sequence must demonstrate an actual progression. Two shapes qualify:
  //   - the text opens with "1." and the in-line run starts at "2." (1.→2.…), or
  //   - the whole list is in-line and starts at "1." with at least a "2." after it.
  //
  // The `numbers.length >= 2` requirement is what makes a LONE marker never
  // qualify. Without it a single coincidental "1." in ordinary prose ("The panel
  // affirmed the IJ's finding. 1. The respondent maintains…") was re-listed, and
  // the wrongly-set flag then let the glued-sentence pass rewrite the entire
  // text. Two regression tests pin both halves of that failure.
  const opensWithOne = /^\s*1\.\s+\p{Lu}/u.test(text);
  const isRealList = (startsAt === 2 && opensWithOne) || (startsAt === 1 && numbers.length >= 2);
  if (!isRealList) return { text, relisted: false };

  // Split the markers first; the closing sentence of these lists arrives glued to
  // the last item ("...to Honduras.A separate written brief...") and gets its own
  // line from the glued-sentence pass. After the marker split every real item
  // boundary is already a newline, so that pass only sees genuine defects.
  const split = text.replace(RUN_ON_MARKER, "\n").replace(GLUED_SENTENCE, ".\n");
  return { text: split, relisted: true };
}

/**
 * Shapes a raw ai_field value into what actually gets stored, previewed and
 * printed. Pure and idempotent: normalizing an already-normalized value is a
 * no-op, which matters because the same text flows through the wizard prefill,
 * the durable cache and the PDF fill.
 */
export function normalizeAiFieldText(
  raw: string | null | undefined,
  opts: AiFieldFormatOptions = {},
): AiFieldFormatResult {
  const base = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!base) return { text: "", overflow: false, relisted: false };

  const { text: listed, relisted } = relistRunOnList(base);

  const text = listed
    // A trailing space before a newline is invisible noise in a form box.
    .replace(/[ \t]+\n/g, "\n")
    // Collapse 3+ newlines into a single blank line.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const max = opts.maxChars ?? 0;
  return { text, overflow: max > 0 && text.length > max, relisted };
}

/**
 * Appends the configured ceiling to a per-field instruction so the number lives
 * in exactly ONE place — `source_ref.max_chars`, edited from the admin — instead
 * of being re-typed into every instruction's prose (where it silently drifts out
 * of sync with what the widget can actually hold).
 */
export function buildAiFieldInstruction(instruction: string, opts: AiFieldFormatOptions = {}): string {
  const max = opts.maxChars ?? 0;
  if (max <= 0) return instruction;
  return (
    `${instruction}\n\n` +
    `HARD LIMIT: the answer MUST NOT exceed ${max} characters (the official form's ` +
    `box cannot hold more — anything longer is cut off and lost). Be concise and stay under it.`
  );
}
