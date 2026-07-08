/**
 * Empty-field fill policy + verbatim detection — shared primitive (lives in
 * `shared/` so the production PDF filler AND the admin preview can resolve the
 * exact same policy). Companion to `conditions.ts`.
 *
 * Two orthogonal concerns the admin configures per form / per field:
 *
 *  1. EMPTY POLICY — when a field is APPLICABLE (visible, not in a do-not-fill
 *     group) but has no value, what does the PDF show? USCIS rejects a blank box
 *     but accepts "N/A" for inapplicable-but-required fields (8 CFR 1208.3(c)(3)).
 *     A version-wide default (`default_empty_policy`) + a per-field override
 *     (`empty_policy` + `empty_placeholder`) decide between: leave BLANK, stamp
 *     "N/A", or stamp a CUSTOM placeholder. The data in the DB stays truthful
 *     (empty = no answer); this only decides how empties RENDER.
 *
 *  2. VERBATIM — a value written to the PDF EXACTLY as stored, never machine-
 *     translated nor PII-masked: A-Numbers, SSNs, passports, dates, codes, and
 *     (via the per-field `no_translate` flag) proper nouns like names and cities.
 *     `isVerbatimValue` is the heuristic safety net that closes the A-Number leak
 *     even on forms the admin has not yet configured; `no_translate` is the
 *     explicit control. A value that is verbatim never reaches `maskPii`, so a
 *     masked token can never become the value printed on a federal form.
 */

/** Version-wide default when a field inherits. `auto` = legacy (text/textarea → N/A). */
export const VERSION_EMPTY_POLICIES = ["auto", "na", "blank"] as const;
export type VersionEmptyPolicy = (typeof VERSION_EMPTY_POLICIES)[number];

/** Per-field override. `inherit` defers to the version default. */
export const FIELD_EMPTY_POLICIES = ["inherit", "na", "blank", "custom"] as const;
export type FieldEmptyPolicy = (typeof FIELD_EMPTY_POLICIES)[number];

/** Default placeholder when a policy fills but no custom string is set. */
export const DEFAULT_EMPTY_PLACEHOLDER = "N/A";

/**
 * Field types whose AcroForm widget is text-backed and can therefore hold a
 * placeholder string. A checkbox/radio (select/multiselect/checkbox) has no text
 * to write, and a `number` box printing "N/A" reads oddly — those stay blank even
 * under an `na` policy (documented). USCIS date fields ARE text widgets, so a
 * missing-but-applicable date can carry "N/A".
 */
const PLACEHOLDER_ELIGIBLE_TYPES: ReadonlySet<string> = new Set(["text", "textarea", "date"]);

export type EmptyResolution = { mode: "blank" } | { mode: "fill"; placeholder: string };

/**
 * Resolves what an APPLICABLE-but-EMPTY field should render, given its per-field
 * override and the version-wide default. Callers first establish that the field is
 * visible (condition satisfied), not required-missing, and not in a do-not-fill
 * group; this decides only blank-vs-placeholder for the leftover empties.
 */
export function resolveEmptyPolicy(
  field: {
    fieldType: string;
    emptyPolicy?: FieldEmptyPolicy | null;
    emptyPlaceholder?: string | null;
  },
  versionDefault: VersionEmptyPolicy = "auto",
): EmptyResolution {
  const override = field.emptyPolicy ?? "inherit";
  const base: VersionEmptyPolicy | "custom" = override === "inherit" ? versionDefault : override;

  if (base === "blank") return { mode: "blank" };

  if (base === "auto") {
    // Legacy behaviour preserved verbatim: only free-text holds "N/A"; dates and
    // everything else stay blank. This is the untouched default for every form
    // that has not opted into a stronger policy.
    return field.fieldType === "text" || field.fieldType === "textarea"
      ? { mode: "fill", placeholder: DEFAULT_EMPTY_PLACEHOLDER }
      : { mode: "blank" };
  }

  // base === "na" | "custom": fill any text-backed widget (text/textarea/date).
  if (!PLACEHOLDER_ELIGIBLE_TYPES.has(field.fieldType)) return { mode: "blank" };
  const placeholder =
    base === "custom" && field.emptyPlaceholder?.trim()
      ? field.emptyPlaceholder.trim()
      : DEFAULT_EMPTY_PLACEHOLDER;
  return { mode: "fill", placeholder };
}

// ---------------------------------------------------------------------------
// Verbatim detection — values that must never be translated or PII-masked.
// ---------------------------------------------------------------------------

const A_NUMBER_RE = /^A-?\d{7,9}$/i;
const SSN_RE = /^\d{3}-?\d{2}-?\d{4}$/;
const PURE_NUMBER_RE = /^[\d\s()+-]{3,}$/; // phone / numeric id (digits + phone punctuation)
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/;
const SLASH_DATE_RE = /^\d{1,2}\/\d{1,4}(?:\/\d{1,4})?$/;

/**
 * True when `value` is a structured/identifier token that must be written to the
 * PDF exactly as-is — an A-Number, SSN, passport/ID code, phone, pure number, or
 * date. These carry no natural-language meaning to translate, and sending them
 * through the translator would (a) mask A-Numbers/SSNs into bullet strings and
 * (b) risk corrupting an identifier. Multi-word natural text (narratives, and
 * names/cities that legitimately have spaces) is NOT caught here — those rely on
 * the explicit per-field `no_translate` flag, so this net never over-triggers.
 */
export function isVerbatimValue(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (A_NUMBER_RE.test(v) || SSN_RE.test(v)) return true;
  if (ISO_DATE_RE.test(v) || SLASH_DATE_RE.test(v)) return true;
  if (PURE_NUMBER_RE.test(v) && /\d/.test(v)) return true;
  // A single token (no whitespace) containing at least one digit — passport
  // numbers, I-94 numbers, alphanumeric case/ID codes.
  if (!/\s/.test(v) && /\d/.test(v) && /^[\p{L}\p{N}\-./]+$/u.test(v)) return true;
  return false;
}
