/**
 * Deterministic token fills for AI court letters (config-as-data via
 * `ai_generation_configs.letter_fill`; frozen into `ConfigSnapshot.letter_fill`).
 *
 * The model emits placeholder tokens for data that must be EXACT rather than
 * transcribed — the appellant's mailing address, the government's service
 * address, the chosen service method — and this module replaces them at render
 * time from the case's confirmed form answers / document extractions. This keeps
 * the drafting model responsible for prose, and code responsible for facts (the
 * same boundary as `{{APPELLANT_SIGNATURE}}` / `{{CURRENT_DATE}}`).
 *
 * Pure and side-effect-free (the caller hydrates `inputs` via loadResolvedInputs)
 * so the resolution logic is unit-testable without a database.
 */
import { resolveOccAddress } from "@/shared/constants/occ-offices";
import { KEEP_TOGETHER_MARKER } from "@/backend/platform/pdf";
import type { LetterFillConfig } from "./domain";

/** The subset of `loadResolvedInputs`'s result that the resolver reads. */
export interface LetterFillInputs {
  documents: Array<{ slug: string; extractionPayload: Record<string, unknown> }>;
  forms: Array<{ slug: string; answers: Record<string, unknown> }>;
}

/** Printable "write it by hand" line used when a value is genuinely unavailable. */
const PRINTABLE_LINE = "______________________________";

/** Honest placeholder kept when the court is not in the OCC directory. */
const OCC_PLACEHOLDER =
  "[OFFICE OF THE CHIEF COUNSEL ADDRESS — confirm the correct office from the EOIR/ICE directory before filing]";

/** Service-method options. `key` is the questionnaire option value (see the seed). */
export const SERVICE_METHOD_LINES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "first_class_mail", label: "First-class United States mail, postage prepaid" },
  { key: "personal_delivery", label: "Personal delivery (hand service)" },
  { key: "ecas", label: "Electronic service through ECAS" },
];

function tokenRegex(name: string): RegExp {
  return new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, "g");
}

/** Replace a token with a literal string (function replacer → no `$` interpretation). */
function replaceToken(text: string, name: string, value: string): string {
  return text.replace(tokenRegex(name), () => value);
}

/** Trim to a non-empty string; null/blank/non-scalar → undefined. */
function cleanScalar(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? undefined : t;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function answerFrom(inputs: LetterFillInputs, formSlug: string, question: string): string | undefined {
  const form = inputs.forms.find((f) => f.slug === formSlug);
  return cleanScalar(form?.answers?.[question]);
}

function extractFrom(
  inputs: LetterFillInputs,
  docSlug: string | undefined,
  field: string | undefined,
): string | undefined {
  if (!docSlug || !field) return undefined;
  const doc = inputs.documents.find((d) => d.slug === docSlug);
  return cleanScalar(doc?.extractionPayload?.[field]);
}

/** Called with a field name whenever a fill DEGRADES to a printable line or the
 *  OCC placeholder — so a silent "blank in a real filing" becomes an ops signal. */
export type OnFallback = (field: string) => void;

function fillAppellantContact(
  text: string,
  c: NonNullable<LetterFillConfig["appellant_contact"]>,
  inputs: LetterFillInputs,
  onFallback?: OnFallback,
): string {
  const fb = c.fallback_document_slug;
  const ff = c.fallback_fields ?? {};

  // Confirmed answer wins; raw extraction is the fallback; a printable line is last.
  let street =
    answerFrom(inputs, c.form_slug, c.address_question) ?? extractFrom(inputs, fb, ff.street);
  const apartment =
    (c.apartment_question ? answerFrom(inputs, c.form_slug, c.apartment_question) : undefined) ??
    extractFrom(inputs, fb, ff.apartment);
  if (street && apartment) street = `${street}, Apt ${apartment}`;

  const cityStateZip =
    answerFrom(inputs, c.form_slug, c.city_state_zip_question) ??
    extractFrom(inputs, fb, ff.city_state_zip);
  const telephone =
    answerFrom(inputs, c.form_slug, c.telephone_question) ?? extractFrom(inputs, fb, ff.telephone);

  if (!street) onFallback?.("appellant_address");
  if (!cityStateZip) onFallback?.("appellant_city_state_zip");
  if (!telephone) onFallback?.("appellant_telephone");

  let out = replaceToken(text, "APPELLANT_ADDRESS", street ?? PRINTABLE_LINE);
  out = replaceToken(out, "APPELLANT_CITY_STATE_ZIP", cityStateZip ?? PRINTABLE_LINE);
  out = replaceToken(out, "APPELLANT_TELEPHONE", telephone ?? PRINTABLE_LINE);
  return out;
}

function fillOccAddress(
  text: string,
  o: NonNullable<LetterFillConfig["occ_address"]>,
  inputs: LetterFillInputs,
  onFallback?: OnFallback,
): string {
  // A confirmed override answer (staff/client) wins — for a court not in the
  // directory. Otherwise the court→OCC lookup; otherwise an honest placeholder.
  const override =
    o.override_form_slug && o.override_question
      ? answerFrom(inputs, o.override_form_slug, o.override_question)
      : undefined;
  let replacement: string;
  if (override) {
    // Free-text staff/client field flowing into HTML-enabled markdown: normalize
    // line breaks and backslash-escape a leading markdown control char per line so
    // a stray '#'/'*'/'>'/'-' cannot garble a real BIA filing.
    replacement = override
      .replace(/\r?\n+/g, "<br>")
      .replace(/(^|<br>)\s*([#*>-])/g, "$1\\$2");
  } else {
    const court = extractFrom(inputs, o.decision_document_slug, o.court_json_path);
    const address = resolveOccAddress(court ?? null);
    if (!address) onFallback?.("occ_address");
    replacement = address ? address.join("<br>") : OCC_PLACEHOLDER;
  }
  return replaceToken(text, "OCC_ADDRESS", replacement);
}

function fillServiceMethod(
  text: string,
  s: NonNullable<LetterFillConfig["service_method"]>,
  inputs: LetterFillInputs,
): string {
  const chosen = (answerFrom(inputs, s.form_slug, s.method_question) ?? "").toLowerCase();
  const block = SERVICE_METHOD_LINES.map(
    (l) => `[${l.key === chosen ? "X" : " "}] ${l.label}`,
  ).join("<br>");
  // The three check-boxes must each begin on their OWN line, below the
  // "Method of service (check one):" label. The model emits the token right after
  // that label separated by a single newline, which markdown collapses to a space
  // (leaving the first box glued to the label). So absorb any break/whitespace the
  // model placed immediately before the token and emit exactly ONE explicit <br>
  // before the first box — robust across a single `\n`, a `<br>`, or a blank line.
  return text.replace(
    /[ \t]*(?:<br\s*\/?>|\r?\n)*[ \t]*\{\{\s*SERVICE_METHOD_CHECKBOXES\s*\}\}/gi,
    () => `<br>${block}`,
  );
}

/**
 * Inserts the renderer's `KEEP_TOGETHER_MARKER` at the START of the letter's closing
 * block so the PDF never orphans the tail (signature / name / address / date) across a
 * page break — when the block would straddle a page, the renderer pushes the WHOLE
 * block onto a fresh page instead. The block is anchored on the `{{APPELLANT_SIGNATURE}}`
 * token and extended UP to include a SHORT lead-in line ("Respectfully submitted," /
 * the perjury declaration) but never a long body paragraph. No-ops when the letter has
 * no signature token. Pure; must run BEFORE the signature token is replaced.
 */
export function markClosingBlockKeepTogether(text: string): string {
  const m = /\{\{\s*APPELLANT_SIGNATURE\s*\}\}/.exec(text);
  if (!m) return text;
  const before = text.slice(0, m.index);
  const pBreak = before.lastIndexOf("\n\n");
  let start = pBreak < 0 ? 0 : pBreak + 2;
  // Pull in one short preceding lead-in line so it stays with the signature.
  if (start >= 2) {
    const prevBreak = text.slice(0, start - 2).lastIndexOf("\n\n");
    const prevStart = prevBreak < 0 ? 0 : prevBreak + 2;
    const prevPara = text.slice(prevStart, start).trim();
    if (prevPara.length > 0 && prevPara.length <= 120 && !prevPara.includes("\n")) {
      start = prevStart;
    }
  }
  return text.slice(0, start) + KEEP_TOGETHER_MARKER + text.slice(start);
}

/**
 * Replaces the letter's deterministic tokens from the case's confirmed answers /
 * extractions. Returns the text unchanged when `cfg` is null or a given block is
 * absent (so letters without a `letter_fill` config are untouched).
 */
export function resolveLetterFillTokens(
  text: string,
  cfg: LetterFillConfig | null | undefined,
  inputs: LetterFillInputs,
  onFallback?: OnFallback,
): string {
  if (!cfg) return text;
  let out = text;
  if (cfg.appellant_contact) out = fillAppellantContact(out, cfg.appellant_contact, inputs, onFallback);
  if (cfg.occ_address) out = fillOccAddress(out, cfg.occ_address, inputs, onFallback);
  if (cfg.service_method) out = fillServiceMethod(out, cfg.service_method, inputs);
  return out;
}
