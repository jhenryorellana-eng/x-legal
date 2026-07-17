/**
 * ai-engine module — pure domain logic (no I/O).
 *
 * All functions here are deterministic given their inputs.
 * The service layer orchestrates I/O and calls into these functions.
 *
 * Key references:
 *   DOC-42-AI-ENGINE §2 (all domain rules — BINDING)
 *   DOC-74-IA §2.3 (prompt caching), §4.2-4.3 (dataset selection),
 *             §5.2 (cost formula), §7.1 (PII masking)
 *   DOC-26-JOBS §2.1 (chunking threshold)
 *
 * @module ai-engine/domain
 */

import type { QuestionCondition } from "@/shared/form-logic/conditions";

// ---------------------------------------------------------------------------
// Generation run state machine (DOC-42 §2.1)
// ---------------------------------------------------------------------------

export type GenerationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

const RUN_TRANSITIONS: Record<GenerationRunStatus, GenerationRunStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["queued"],
  cancelled: [],
};

/**
 * Returns true when the transition (from → to) is valid per the state machine.
 * Terminal states (completed, cancelled) accept no further transitions.
 * `failed → queued` is the ONLY allowed re-entry (manual admin retry, DOC-26 §5.3).
 */
export function canTransitionRun(
  from: GenerationRunStatus,
  to: GenerationRunStatus,
): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Version management (DOC-42 §2.3)
// ---------------------------------------------------------------------------

/**
 * Returns the next version number for a (case, form, party) tuple.
 * Never reuses or fills gaps — always max+1.
 */
export function nextVersion(currentMax: number | null): number {
  return (currentMax ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Config snapshot type (DOC-42 §3.1.1)
// ---------------------------------------------------------------------------

/**
 * A configurable section of a long-form generation (generalizes v1's 17 asylum
 * sections). Structurally identical to catalog's GenerationSection.
 */
export interface GenerationSectionSpec {
  key: string;
  heading: string;
  min_words: number;
  max_tokens: number;
  guidance: string;
  type: "doctrinal" | "narrative" | "analysis";
  /** Optional per-section model override (e.g. Opus for the dense nexus section). */
  model?: string | null;
}

/**
 * Default anti-invention guardrails (generic, adapted from v1's R1-R7). Injected
 * into the system prompt when `rules_enabled` and no custom `rules_text`.
 */
export const DEFAULT_GENERATION_RULES = [
  "ABSOLUTE RULES (do NOT violate):",
  "R1. NEVER invent facts, dates, names, places or events about the client. Every concrete client fact must trace to the provided case context (form answers, extracted documents). Legal argument and general context may be developed at length; CLIENT FACTS may not be invented.",
  "R2. NEVER promote the client's characterization (e.g. \"they took my money\" does not become \"extortion\"; \"they hit me\" does not become \"torture\") unless a section is explicitly arguing that characterization as legal argument, flagged as argument and not fact.",
  "R3. NEVER invent quotations attributed to the client.",
  "R4. Cite jurisprudence, statistics, news or sources ONLY from verified material (web_search results when enabled, or the provided reference dataset/context). NEVER fabricate a citation, holding, statistic or URL.",
  "R5. Maintain a professional, clinical, authoritative tone appropriate to an elite legal filing.",
  "R6. When a required client fact is missing, write a clear placeholder (e.g. \"[TO BE CONFIRMED]\") rather than inventing it.",
  "R7. The reference dataset (if any) is style/argumentation guidance only — NEVER a source of facts for the current case.",
  "R8. Write clean, professional prose for a court filing. Use plain ASCII punctuation (straight quotes and hyphens). Do NOT use decorative symbols, bullet glyphs, box-drawing characters, emojis, ASCII-art separators, or markdown decoration in the legal body — use complete sentences and standard paragraphs. Start each section with its assigned heading and nothing else.",
].join("\n");

/**
 * Document-structure config, editable from the admin form-editor. `blocks` is an
 * ordered, toggleable list of structural blocks (supersedes the legacy booleans
 * when present), so each letter type defines its own structure without code
 * changes. `cover_page` defines the first-page title + rows (label + value, where
 * value may contain {{tokens}} resolved from the case/extraction context).
 */
export type AssemblyBlockType =
  | "cover" | "toc" | "body" | "chronology" | "conclusions" | "annexes" | "closing";
export interface AssemblyBlockSpec {
  type: AssemblyBlockType;
  enabled?: boolean;
}
export interface CoverRowSpec {
  label: string;
  value: string;
}
export interface AssemblyConfig {
  // Legacy booleans — still read when `blocks` is absent (backward compatible).
  cover?: boolean;
  toc?: boolean;
  chronology?: boolean;
  annexes?: boolean;
  closing?: string | null;
  // Structured, admin-orderable structure (preferred when present).
  blocks?: AssemblyBlockSpec[];
  cover_page?: { title?: string; rows?: CoverRowSpec[] };
}

export interface ConfigSnapshot {
  system_prompt: string;
  input_document_slugs: string[];
  input_form_slugs: string[];
  dataset_id: string | null;
  model: string;
  max_output_tokens: number;
  output_format: "pdf" | "docx" | "md";
  output_language: "es" | "en" | "both";
  // --- v1-grade engine (generic, configurable) ---
  web_search_enabled?: boolean;
  web_search_max_uses?: number;
  research_instructions?: string | null;
  research_model?: string | null;
  sections?: GenerationSectionSpec[];
  rules_enabled?: boolean;
  rules_text?: string | null;
  assembly?: AssemblyConfig | null;
  /**
   * Run-derived verified research (analysis + jurisprudence + country conditions),
   * persisted ONCE so every section cites consistently AND the annexes can reuse
   * it later. Follows the existing `dataset_injection` precedent (run output kept
   * in config_snapshot — survives completion, no extra column/migration needed).
   */
  research?: ResearchBundle | null;
  resolved_inputs: {
    documents: Array<{
      slug: string;
      case_document_id: string;
      extraction_id: string;
    }>;
    forms: Array<{ slug: string; response_id: string }>;
  };
  dataset_injection: {
    item_ids: string[];
    total_tokens: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Prompt assembly types (DOC-42 §2.2)
// ---------------------------------------------------------------------------

export interface SystemBlock {
  text: string;
  cacheControl?: "ephemeral";
}

export interface PromptAssembly {
  /** system[0] = system_prompt; system[1] = dataset XML (if any) */
  system: SystemBlock[];
  /** Variable messages: context + docs + format instructions */
  messages: Array<{ role: "user"; content: string }>;
  /** Dataset injection summary for config_snapshot.dataset_injection */
  datasetInjection: { itemIds: string[]; totalTokens: number } | null;
}

// ---------------------------------------------------------------------------
// Dataset item type
// ---------------------------------------------------------------------------

/** Structured annex metadata on a dataset item (migration 0051). Drives the
 *  dataset-sourced jurisprudence exhibits when web_search case-law is unreliable. */
export interface DatasetItemMeta {
  kind?: "precedent" | "country" | "model";
  citation?: string;
  court?: string;
  year?: string;
  url?: string;
  holding?: string;
}

export interface DatasetItem {
  id: string;
  title: string;
  content: string | null;
  tags: string[];
  outcome: string | null;
  token_count: number; // already filtered: never null when passed to selectDatasetItems
  created_at: string;
  jurisdiction: string | null;
  meta?: DatasetItemMeta;
}

// ---------------------------------------------------------------------------
// Prompt assembly inputs
// ---------------------------------------------------------------------------

export interface ResolvedInputs {
  documents: Array<{
    slug: string;
    extractionPayload: Record<string, unknown>;
    rawText: string;
    /** Human file label (display_name/original_filename) — distinguishes the N
     *  coexisting documents of an allow_multiple slug in the prompt. */
    label?: string;
  }>;
  forms: Array<{
    slug: string;
    answers: Record<string, unknown>;
  }>;
}

export interface RunContext {
  serviceSlug?: string;
  phaseSlug?: string;
  jurisdiction?: string;
}

// ---------------------------------------------------------------------------
// PII masking (DOC-74 §7.1)
// ---------------------------------------------------------------------------

// SSN: 9 digits, optionally dashes — e.g. 123-45-6789 or 123456789
// Show only last 4 digits → •••-••-XXXX
const SSN_RE = /\b(\d{3}[- ]?\d{2}[- ]?)(\d{4})\b/g;

// A-Number: A followed by 7-9 digits — e.g. A123456789
// Mask entirely → A-•••-•••
const A_NUMBER_RE = /\bA-?(\d{7,9})\b/gi;

// Passport numbers: common formats (2 letters + 6-8 digits, or 1-2 letters + 6-9 chars)
// E.g. US passport: 9 digits; MX: 1-2 letters + 7 digits
// Mask last 4 → XXXXX••••YYYY
const PASSPORT_RE = /\b([A-Z]{1,2}\d{5,8}|\d{8,9})\b/g;

/**
 * Masks PII patterns in a string per DOC-74 §7.1.
 *
 * Patterns masked:
 *   SSN:       123-45-6789 → •••-••-6789
 *   A-Number:  A123456789  → A-•••-•••
 *   Passport:  AB1234567   → ••••••567 (last 3 visible)
 *
 * This is a best-effort mask: handles the most common formats.
 * Fields marked pii_encrypted are NEVER passed to this function
 * (they are never loaded into prompt context at all — DOC-74 §7.1).
 */
export function maskPii(text: string): string {
  if (!text) return text;

  let result = text;

  // SSN: show only last 4 digits
  result = result.replace(SSN_RE, (_match, _prefix, last4) => `•••-••-${last4}`);

  // A-Number: mask entirely
  result = result.replace(A_NUMBER_RE, "A-•••-•••");

  // Passport: show only last 3 chars
  result = result.replace(PASSPORT_RE, (match) => {
    if (match.length < 4) return match; // too short to be a passport number
    const visible = match.slice(-3);
    return "•".repeat(match.length - 3) + visible;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Reversible PII masking (T5 "Mejorar con IA")
// ---------------------------------------------------------------------------
//
// The lossy maskPii above destroys the value (last-4 only) — fine for prompt
// CONTEXT, fatal for a rewrite flow where the model's output replaces the
// client's answer (an EOIR-26 A-Number must survive verbatim). Here each PII
// match becomes an opaque token the model is instructed to preserve, and the
// caller restores the originals after the response. If the model drops a
// token, validateImprovedText rejects the output and the answer is untouched.

export interface ReversiblePiiMask {
  masked: string;
  /** token (⟦PII_n⟧) → original value */
  tokens: Map<string, string>;
}

// Order matters: more specific patterns first, so e.g. a grouped A-Number is
// tokenized before the bare-digits passport pattern can bite a fragment of it.
// Includes the grouped A### ### ### / A###-###-### form the compact
// A_NUMBER_RE above does not catch.
const REVERSIBLE_PII_PATTERNS: RegExp[] = [
  /\bA[- ]?\d{3}[- ]\d{3}[- ]\d{3}\b/gi, // A-Number, grouped (A312-654-987)
  /\bA-?\d{7,9}\b/gi, // A-Number, compact (A312654987)
  /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, // SSN
  /\b(?:[A-Z]{1,2}\d{5,8}|\d{8,9})\b/g, // passport-like
];

// ASCII token on purpose: models reproduce [[PII_n]] far more reliably than
// exotic unicode brackets (a live haiku run dropped a ⟦PII_n⟧ token).
export function maskPiiReversible(text: string): ReversiblePiiMask {
  const tokens = new Map<string, string>();
  if (!text) return { masked: text, tokens };

  const tokenByValue = new Map<string, string>();
  let counter = 0;
  let masked = text;

  for (const pattern of REVERSIBLE_PII_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      const existing = tokenByValue.get(match);
      if (existing) return existing;
      counter += 1;
      const token = `[[PII_${counter}]]`;
      tokenByValue.set(match, token);
      tokens.set(token, match);
      return token;
    });
  }

  return { masked, tokens };
}

export function restorePii(text: string, tokens: Map<string, string>): string {
  let result = text;
  for (const [token, original] of tokens) {
    result = result.replaceAll(token, original);
  }
  return result;
}

const PII_TOKEN_RE = /\[\[PII_\d+\]\]/g;

// A-Number canonical format for the improve flow (Henry, 2026-07-16): `A-` +
// 9 digits (pad an 8-digit number with a leading zero). DETERMINISTIC — the
// model never sees the digits (they travel as ⟦PII_n⟧ tokens), so the required
// format is applied here in code after restorePii. Only A-prefixed values are
// touched: bare digit runs stay verbatim (they could be a passport/SSN — never
// guess). Digits are NEVER altered, only separators/prefix.
const A_NUMBER_ANYFORM_RE = /\bA[-\s]?\d(?:[-\s]?\d){7,8}\b/gi;

export function normalizeANumbersInText(text: string): string {
  if (!text) return text;
  return text.replace(A_NUMBER_ANYFORM_RE, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length !== 8 && digits.length !== 9) return match;
    return `A-${digits.padStart(9, "0")}`;
  });
}

/**
 * Validates (and lightly normalizes) the model output of an improve call,
 * BEFORE PII restoration. Fail-safe: any rejection means the client's text
 * stays untouched.
 */
export function validateImprovedText(
  maskedInput: string,
  output: string,
): { ok: true; text: string } | { ok: false; reason: string } {
  let text = (output ?? "").trim();

  // Strip a wrapping markdown code fence (```…``` with optional language tag).
  const fence = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fence) text = fence[1].trim();

  // Strip a single pair of wrapping quotes ([\s\S] instead of the dotAll flag —
  // the TS target predates es2018).
  const quoted = text.match(/^["“]([\s\S]*)["”]$/);
  if (quoted) text = quoted[1].trim();

  // Drop a chatty one-line preamble ("Aquí está el texto corregido:", "Here is…:").
  // No \b after the keyword: JS \b misfires on non-ASCII letters like "í".
  const lines = text.split("\n");
  if (lines.length > 1 && /^(aquí|aqui|here|claro|sure)[\s,].*:\s*$/i.test(lines[0].trim())) {
    text = lines.slice(1).join("\n").trim();
  }

  if (!text) return { ok: false, reason: "empty" };

  // Every PII token in the input must survive verbatim.
  const inputTokens = maskedInput.match(PII_TOKEN_RE) ?? [];
  for (const token of new Set(inputTokens)) {
    if (!text.includes(token)) return { ok: false, reason: `missing_token:${token}` };
  }

  // Sanity on size: a rewrite should stay in the same order of magnitude.
  // (+200 gives headroom for format expansion of very short inputs.)
  const len = maskedInput.length;
  if (text.length < Math.floor(len / 4) || text.length > len * 4 + 200) {
    return { ok: false, reason: "length_out_of_bounds" };
  }

  return { ok: true, text };
}

// ---------------------------------------------------------------------------
// Cost computation (DOC-74 §5.2)
// ---------------------------------------------------------------------------

interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Cache read multiplier: 0.10× input price */
  cacheReadMul: number;
  /** Cache write multiplier: 1.25× input price */
  cacheWriteMul: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": {
    inputPerMTok: 10.0,
    outputPerMTok: 50.0,
    cacheReadMul: 0.1,
    cacheWriteMul: 1.25,
  },
  "claude-sonnet-4-6": {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadMul: 0.1,
    cacheWriteMul: 1.25,
  },
  // claude-opus-4-7: premium (asylum-memo research). $5/$25 per MTok per Anthropic's
  // official pricing (verified 2026-07-15) — was previously $15/$75, which inflated the
  // recorded cost_usd ~3× and the /admin/ai-costs budget alerts.
  "claude-opus-4-7": {
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadMul: 0.1,
    cacheWriteMul: 1.25,
  },
  "claude-haiku-4-5": {
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    cacheReadMul: 0.1,
    cacheWriteMul: 1.25,
  },
};

export interface AnthropicUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * Computes cost_usd for an Anthropic API call per DOC-74 §5.2.
 *
 * Formula (4 decimal places):
 *   cost = (input_non_cached × P_in
 *          + cache_creation × P_in × 1.25
 *          + cache_read    × P_in × 0.10
 *          + output         × P_out) / 1_000_000
 *
 * If model is unknown, returns null (never blocks a run — DOC-74 §5.1).
 */
export function computeAnthropicCost(
  usage: AnthropicUsage,
  model: string,
): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  const regularInput =
    usage.inputTokens -
    usage.cacheCreationInputTokens -
    usage.cacheReadInputTokens;

  const costRaw =
    (regularInput * pricing.inputPerMTok +
      usage.cacheCreationInputTokens * pricing.inputPerMTok * pricing.cacheWriteMul +
      usage.cacheReadInputTokens * pricing.inputPerMTok * pricing.cacheReadMul +
      usage.outputTokens * pricing.outputPerMTok) /
    1_000_000;

  return parseFloat(costRaw.toFixed(4));
}

export interface GeminiUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Computes cost_usd for a Gemini API call per DOC-74 §5.2.
 *
 * Gemini 2.5 Flash: $0.30 input / $2.50 output per MTok (June 2026).
 * No cache component in V2.0.
 */
export function computeGeminiCost(usage: GeminiUsage): number {
  const costRaw =
    (usage.inputTokens * 0.3 + usage.outputTokens * 2.5) / 1_000_000;
  return parseFloat(costRaw.toFixed(4));
}

// ---------------------------------------------------------------------------
// Budget evaluation (DOC-42 §2.5 / DOC-74 §5.3)
// ---------------------------------------------------------------------------

export type BudgetCheck = "ok" | "over_80" | "over_100";

/**
 * Evaluates whether monthly spend crosses the 80% or 100% budget threshold.
 *
 * NEVER blocks a run — result is a warning signal only (DOC-74 §5.3).
 * Returns 'ok' if no budget is configured (null or ≤ 0).
 */
export function evaluateBudget(
  spentMonthUsd: number,
  budgetUsd: number | null,
): BudgetCheck {
  if (budgetUsd == null || budgetUsd <= 0) return "ok";
  const ratio = spentMonthUsd / budgetUsd;
  if (ratio >= 1) return "over_100";
  if (ratio >= 0.8) return "over_80";
  return "ok";
}

// ---------------------------------------------------------------------------
// Chunking decision (DOC-42 §2.4 / DOC-26 §2.1)
// ---------------------------------------------------------------------------

/** Tokens-per-second estimate for legal generation (Fable 5, high effort) */
const TOKENS_PER_SECOND = 200;

/**
 * Decides whether a generation run needs chunking (continuation+checkpoint).
 *
 * Triggers if:
 *   - max_output_tokens > 32 000, OR
 *   - projected duration (input+output / TOKENS_PER_SECOND) > 200 s
 *
 * DOC-26 §2.1 / DOC-42 §2.4.
 */
export function decideChunking(
  maxOutputTokens: number,
  estimatedInputTokens: number,
): boolean {
  if (maxOutputTokens > 32_000) return true;
  const projectedSeconds =
    (estimatedInputTokens + maxOutputTokens) / TOKENS_PER_SECOND;
  return projectedSeconds > 200;
}

// ---------------------------------------------------------------------------
// Dataset item selection (DOC-74 §4.3 / DOC-42 §2.2)
// ---------------------------------------------------------------------------

const DEFAULT_DATASET_BUDGET = 50_000;
const DATASET_BUDGET_MARGIN = 0.9; // 10% safety margin (DOC-74 §4.2)

/**
 * Selects dataset items greedily within the token budget, ordered by relevance.
 *
 * Relevance order (DOC-74 §4.3):
 *   1. Tags intersection with context (more intersection = higher rank)
 *   2. outcome = 'granted' before others
 *   3. More recent first (created_at desc)
 *
 * An item is included whole or not at all. Exception: if the FIRST item already
 * exceeds the budget, it is truncated with a marker.
 *
 * Items without token_count are EXCLUDED (they have been filtered before calling).
 *
 * @param items    Dataset items with non-null token_count
 * @param context  Run context for tags matching
 * @param budget   Token budget (default 50 000 × 0.9)
 */
export function selectDatasetItems(
  items: DatasetItem[],
  context: RunContext,
  budget: number = DEFAULT_DATASET_BUDGET,
): { selectedItems: DatasetItem[]; totalTokens: number } {
  const effectiveBudget = Math.floor(budget * DATASET_BUDGET_MARGIN);

  const contextTags = [
    context.serviceSlug,
    context.phaseSlug,
    context.jurisdiction,
  ].filter(Boolean) as string[];

  // Score each item
  const scored = items.map((item) => {
    const intersection = item.tags.filter((t) => contextTags.includes(t)).length;
    // Favorable = granted (asylum wins) or remanded (appeal wins at the BIA/circuit).
    const outcomeScore = item.outcome === "granted" || item.outcome === "remanded" ? 1 : 0;
    return { item, intersection, outcomeScore };
  });

  // Sort: tags intersection DESC → outcome DESC → created_at DESC
  scored.sort((a, b) => {
    if (b.intersection !== a.intersection) return b.intersection - a.intersection;
    if (b.outcomeScore !== a.outcomeScore) return b.outcomeScore - a.outcomeScore;
    return b.item.created_at.localeCompare(a.item.created_at);
  });

  const selectedItems: DatasetItem[] = [];
  let totalTokens = 0;

  for (const { item } of scored) {
    const remaining = effectiveBudget - totalTokens;
    if (item.token_count <= remaining) {
      selectedItems.push(item);
      totalTokens += item.token_count;
    } else if (selectedItems.length === 0) {
      // First item exceeds budget: include truncated version
      const truncated: DatasetItem = {
        ...item,
        content: truncateToTokenBudget(item.content ?? "", remaining),
        token_count: remaining,
      };
      selectedItems.push(truncated);
      totalTokens += remaining;
      break;
    }
    // else: skip items that don't fit (no partial inclusion after first)
  }

  return { selectedItems, totalTokens };
}

/** Very rough character-based truncation (1 token ≈ 4 chars for English/Spanish) */
function truncateToTokenBudget(text: string, tokenBudget: number): string {
  const charBudget = tokenBudget * 4;
  if (text.length <= charBudget) return text;
  return text.slice(0, charBudget) + "\n[... truncado por presupuesto de contexto ...]";
}

// ---------------------------------------------------------------------------
// Prompt assembly (DOC-42 §2.2 — ORDER IS BINDING)
// ---------------------------------------------------------------------------

/**
 * Assembles the prompt for a T1 generation run.
 *
 * Order is fixed (DOC-74 §2.3 — prefix-match caching requires this):
 *   system[0] = config.system_prompt          (stable)
 *   system[1] = dataset XML                    (stable) ← cache_control ephemeral HERE
 *   messages  = case context + docs + format   (variable)
 *
 * Nothing variable goes in system[]. All case data in messages.
 * PII is masked before injection (DOC-74 §7.1).
 */
export function assemblePrompt(
  snapshot: ConfigSnapshot,
  inputs: ResolvedInputs,
  selectedDataset: { selectedItems: DatasetItem[]; totalTokens: number },
  outputLanguage?: string,
): PromptAssembly {
  const system: SystemBlock[] = [];

  // system[0]: system prompt + anti-invention rules (stable). Rules default to
  // DEFAULT_GENERATION_RULES unless the admin disabled them or supplied custom text.
  const rulesBlock =
    snapshot.rules_enabled === false
      ? ""
      : `\n\n${(snapshot.rules_text && snapshot.rules_text.trim()) || DEFAULT_GENERATION_RULES}`;
  system.push({ text: snapshot.system_prompt + rulesBlock });

  // system[1]: dataset XML (stable) — carries cache_control
  let datasetInjection: PromptAssembly["datasetInjection"] = null;

  if (selectedDataset.selectedItems.length > 0) {
    const datasetXml = buildDatasetXml(selectedDataset.selectedItems);
    // cache_control on the LAST stable block
    system.push({ text: datasetXml, cacheControl: "ephemeral" });
    datasetInjection = {
      itemIds: selectedDataset.selectedItems.map((i) => i.id),
      totalTokens: selectedDataset.totalTokens,
    };
  } else {
    // No dataset: cache_control on system[0] (the only stable block)
    system[0] = { ...system[0], cacheControl: "ephemeral" };
  }

  // messages: variable content (case context + docs + format instructions)
  const userContent = buildUserMessage(snapshot, inputs, outputLanguage);

  return {
    system,
    messages: [{ role: "user", content: userContent }],
    datasetInjection,
  };
}

/**
 * Builds the dataset XML block per DOC-74 §4.1.
 * Format: <dataset ...><caso n="1" ...>{content}</caso></dataset>
 */
function buildDatasetXml(items: DatasetItem[]): string {
  const casos = items
    .map(
      (item, idx) =>
        `<caso n="${idx + 1}" titulo="${escapeXml(item.title)}" resultado="${escapeXml(item.outcome ?? "")}" tags="${escapeXml(item.tags.join(","))}">\n${escapeXml(item.content ?? "")}\n</caso>`,
    )
    .join("\n");

  return [
    `<dataset proposito="referencia_estilo_argumentacion">`,
    casos,
    `</dataset>`,
    ``,
    `NOTA: El dataset anterior es material de referencia de estilo, estructura y argumentación.`,
    `NO es fuente de hechos del caso actual. Los hechos vienen exclusivamente del contexto del caso a continuación.`,
  ].join("\n");
}

/**
 * Builds the user message with case context, documents, and format instructions.
 * All case data is PII-masked before injection.
 */
/**
 * Builds the CASE-CONTEXT blocks (extractions payload + form answers + full
 * document text), all PII-masked. Shared by the document generator
 * (buildUserMessage) and the per-case questionnaire generator
 * (buildQuestionGenContext) so both read the case the exact same way.
 */
/** Raw-text budget for the single document of a slug (the core record — e.g. the
 *  full asylum package — must arrive near-whole). */
export const GENERATION_DOC_CHAR_BUDGET = 300_000;
/** Raw-text budget per document when a slug carries several (allow_multiple
 *  evidences): keeps asilo + decisión + N evidencias inside every section call. */
export const GENERATION_MULTI_DOC_CHAR_BUDGET = 80_000;

/** Head+tail truncation with a visible marker — never a silent cap (the model
 *  must know it saw a partial document). Shared by the generation context
 *  (budgetDocText) and the Pre-Mortem (service's budgetTextHeadTail adds logging). */
export function headTailClip(text: string, budget: number, markerLabel: string): string {
  if (text.length <= budget) return text;
  const head = Math.floor(budget * 0.7);
  const tail = budget - head;
  const omitted = text.length - budget;
  return (
    text.slice(0, head) +
    `\n\n[... ${markerLabel} truncado por presupuesto: ${omitted} chars omitidos ...]\n\n` +
    text.slice(text.length - tail)
  );
}

function budgetDocText(text: string, budget: number): string {
  return headTailClip(text, budget, "documento");
}

/** Sanitizes a client-typed file label (case_documents.display_name) before it is
 *  interpolated next to prompt delimiters: strips newlines/quotes and collapses
 *  `---` runs so a malicious or unlucky filename can't forge document boundaries. */
export function sanitizeDocLabel(label: string): string {
  return label
    .replace(/[\r\n]+/g, " ")
    .replace(/["“”]/g, "'")
    .replace(/-{3,}/g, "–")
    .trim()
    .slice(0, 120);
}

export function buildCaseContextBlocks(inputs: ResolvedInputs): string[] {
  const parts: string[] = [];

  // Per-doc heading + budget: a slug with N>1 coexisting documents (allow_multiple)
  // renders each as `slug [n/N] — "label"` with the smaller per-doc budget; a
  // single-doc slug keeps the legacy `slug` heading byte-identical.
  const countBySlug = new Map<string, number>();
  for (const d of inputs.documents) countBySlug.set(d.slug, (countBySlug.get(d.slug) ?? 0) + 1);
  const seenBySlug = new Map<string, number>();
  const docMeta = inputs.documents.map((d) => {
    const n = countBySlug.get(d.slug) ?? 1;
    const i = (seenBySlug.get(d.slug) ?? 0) + 1;
    seenBySlug.set(d.slug, i);
    const heading = n <= 1 ? d.slug : `${d.slug} [${i}/${n}]${d.label ? ` — "${sanitizeDocLabel(d.label)}"` : ""}`;
    const budget = n <= 1 ? GENERATION_DOC_CHAR_BUDGET : GENERATION_MULTI_DOC_CHAR_BUDGET;
    return { heading, budget };
  });

  // 1. CASE CONTEXT — extractions payload (field-by-field, labeled by slug)
  if (inputs.documents.length > 0) {
    parts.push("## DATOS EXTRAÍDOS DE DOCUMENTOS");
    for (const [idx, doc] of inputs.documents.entries()) {
      parts.push(`\n### Documento: ${docMeta[idx].heading}`);
      const maskedPayload = maskObjectValues(doc.extractionPayload);
      for (const [key, value] of Object.entries(maskedPayload)) {
        parts.push(`- **${key}**: ${String(value)}`);
      }
    }
  }

  // 2. CASE CONTEXT — form responses (question → value)
  if (inputs.forms.length > 0) {
    parts.push("\n## RESPUESTAS DEL FORMULARIO");
    for (const form of inputs.forms) {
      parts.push(`\n### Formulario: ${form.slug}`);
      const maskedAnswers = maskObjectValues(form.answers);
      for (const [key, value] of Object.entries(maskedAnswers)) {
        parts.push(`- **${key}**: ${String(value)}`);
      }
    }
  }

  // 3. FULL DOCUMENT TEXTS (raw_text)
  if (inputs.documents.length > 0) {
    parts.push("\n## TEXTO COMPLETO DE DOCUMENTOS");
    for (const [idx, doc] of inputs.documents.entries()) {
      parts.push(`\n--- INICIO DOCUMENTO: ${docMeta[idx].heading} ---`);
      parts.push(budgetDocText(maskPii(doc.rawText), docMeta[idx].budget));
      parts.push(`--- FIN DOCUMENTO: ${docMeta[idx].heading} ---`);
    }
  }

  return parts;
}

function buildUserMessage(
  snapshot: ConfigSnapshot,
  inputs: ResolvedInputs,
  outputLanguage?: string,
): string {
  const parts = buildCaseContextBlocks(inputs);

  // 4. FORMAT/LANGUAGE INSTRUCTIONS (fixed platform block)
  const lang = outputLanguage ?? snapshot.output_language ?? "es";
  parts.push("\n## INSTRUCCIONES DE FORMATO Y IDIOMA");
  parts.push(buildFormatInstructions(lang, snapshot.max_output_tokens));

  return parts.join("\n");
}

/**
 * Builds the user message for the PER-CASE questionnaire generator (Ola 3):
 * the same masked case context (I-589 answers + uploaded documents), plus the
 * list of base questions already covered so the AI adds ONLY deeper follow-ups.
 */
export function buildQuestionGenContext(
  inputs: ResolvedInputs,
  alreadyCoveredQuestions: string[],
): string {
  const parts = buildCaseContextBlocks(inputs);
  if (inputs.documents.length === 0 && inputs.forms.length === 0) {
    parts.push("(No hay documentos ni respuestas de formulario disponibles todavía.)");
  }
  if (alreadyCoveredQuestions.length > 0) {
    parts.push("\n## PREGUNTAS YA CUBIERTAS (NO las repitas — solo profundiza más allá de estas)");
    alreadyCoveredQuestions.forEach((q, i) => parts.push(`${i + 1}. ${q}`));
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Ola 3 — Per-case generated questionnaire schema (stored as jsonb on the instance)
// ---------------------------------------------------------------------------

/** The 6 canonical client-answerable field types (mirrors form_questions). */
export const QUESTIONNAIRE_FIELD_TYPES = [
  "text", "textarea", "number", "date", "checkbox", "select",
] as const;
export type QuestionnaireFieldType = (typeof QUESTIONNAIRE_FIELD_TYPES)[number];

export interface GeneratedQuestion {
  /** Stable uuid — answers are keyed by this id (survives regeneration). */
  id: string;
  question_i18n: { es: string; en: string };
  help_i18n: { es: string; en: string } | null;
  field_type: QuestionnaireFieldType;
  options: Array<{ value: string; label_i18n: { es: string; en: string } }> | null;
  is_required: boolean;
  position: number;
  /** Always 'client_answer' — the client fills these. */
  source: "client_answer";
  validation: { regex?: string; min?: number; max?: number } | null;
  /** Conditional visibility, with `when.question` already resolved to a uuid. */
  condition: QuestionCondition | null;
}
export interface GeneratedGroup {
  id: string;
  title_i18n: { es: string; en: string };
  position: number;
  questions: GeneratedQuestion[];
}
/** The full generated questionnaire stored in case_questionnaire_instances.schema. */
export interface QuestionnaireSchema {
  groups: GeneratedGroup[];
}

function buildFormatInstructions(outputLanguage: string, maxOutputTokens: number): string {
  const langInstructions: Record<string, string> = {
    es: "Escribe el documento completo en ESPAÑOL.",
    en: "Write the complete document in ENGLISH.",
    both: "Write the main document in ENGLISH. Add a final section titled 'Versión en español' with the complete Spanish translation.",
  };

  return [
    langInstructions[outputLanguage] ?? langInstructions["es"],
    "Usa formato Markdown: ## para secciones principales, ### para subsecciones, párrafos y listas.",
    `Extensión orientada a ${maxOutputTokens} tokens de salida. Sé exhaustivo y preciso.`,
    "PROHIBICIÓN ABSOLUTA: No inventes hechos, fechas, nombres o circunstancias que no estén presentes en el contexto del caso.",
    "El dataset es solo referencia de estilo — los hechos SOLO vienen del contexto del caso.",
  ].join("\n");
}

/**
 * Recursively masks PII in any nested string value (DOC-74 §7.1).
 * extraction_schema payloads and form answers are arbitrary JSON — a US passport
 * extraction nests SSN/A-number/passport at depth ≥2, so a shallow mask would let
 * those reach the AI provider unmasked. Strings → maskPii; arrays/objects → recurse.
 */
function maskDeep(value: unknown): unknown {
  if (typeof value === "string") return maskPii(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskDeep(v);
    }
    return out;
  }
  return value;
}

/** Applies maskPii to every (possibly nested) string value in a record. */
function maskObjectValues(obj: Record<string, unknown>): Record<string, unknown> {
  return maskDeep(obj) as Record<string, unknown>;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Output validation (DOC-42 §2.6 / DOC-74 §6.4)
// ---------------------------------------------------------------------------

export type OutputValidationResult =
  | { ok: true }
  | { ok: false; reason: string; code: "EMPTY" | "TOO_SHORT" | "TRUNCATED" | "REFUSAL" };

const MIN_OUTPUT_CHARS = 800;

/**
 * Validates the AI generation output per DOC-74 §6.4.
 *
 * Checks:
 *   1. Not empty
 *   2. Minimum length (MIN_OUTPUT_CHARS)
 *   3. stop_reason = 'end_turn' (not 'max_tokens' → truncated, not 'refusal')
 *
 * @param outputText  The text returned by the AI
 * @param stopReason  The stop_reason from the API response
 * @param minLength   Minimum character length (default 800)
 */
export function validateGenerationOutput(
  outputText: string,
  stopReason: string,
  minLength: number = MIN_OUTPUT_CHARS,
): OutputValidationResult {
  if (!outputText || outputText.trim().length === 0) {
    return { ok: false, reason: "Output vacío", code: "EMPTY" };
  }

  if (stopReason === "refusal") {
    return {
      ok: false,
      reason: "El modelo rechazó generar el contenido (clasificador de seguridad). Ajusta las entradas o el prompt del sistema.",
      code: "REFUSAL",
    };
  }

  if (stopReason === "max_tokens") {
    return {
      ok: false,
      reason: "Output truncado — sube max_output_tokens en la configuración del formulario.",
      code: "TRUNCATED",
    };
  }

  if (outputText.trim().length < minLength) {
    return {
      ok: false,
      reason: `Output demasiado corto (${outputText.trim().length} chars, mínimo ${minLength}).`,
      code: "TOO_SHORT",
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Checkpoint types (DOC-42 §2.4)
// ---------------------------------------------------------------------------

export interface ChunkProgress {
  chunk: {
    index: number;
    partPaths: string[];
  };
  sectionsPlan: string[] | null;
  sectionsDone: number;
  usageAccum: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    costUsd: number;
  };
}

/**
 * Checkpoint for the resumable sectioned long-form engine (v1's self-chaining
 * generalized). Stored in `ai_generation_runs.progress`; carries the accumulated
 * section bodies + continuity tail so a re-enqueued invocation resumes exactly
 * where the previous one stopped (timeout-safe). Cleared on completion.
 */
export interface SectionedProgress {
  kind: "sectioned";
  /** Drafting checkpoint: how many sections are already accumulated in `parts`. */
  sectionsDone: number;
  /** Accumulated section markdown (already assembled per section). */
  parts: string[];
  /** Continuity tail handed to the next section. */
  prevTail: string;
  usage: AnthropicUsage;
  costUsd: number;
  /** Last model used (drives completeRun's recorded model). */
  modelUsed: string;
  /**
   * Research sub-step checkpoint (resumable): 0 = not started, 1 = analysis done,
   * 2 = jurisprudence done, 3 = research complete. Lets a re-enqueued invocation
   * resume the research phase without re-running the expensive web_search calls,
   * so research (analysis + two web_search calls) never blows maxDuration.
   */
  researchStep?: number;
}

/**
 * Sums usage across multiple API calls (multi-chunk runs, validation retries).
 * Returns a merged usage object suitable for cost calculation and token logging.
 */
export function sumUsage(
  accum: ChunkProgress["usageAccum"] | null | undefined,
  newUsage: AnthropicUsage & { costUsd: number },
): ChunkProgress["usageAccum"] {
  const base = accum ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: 0,
  };

  return {
    inputTokens: base.inputTokens + newUsage.inputTokens,
    outputTokens: base.outputTokens + newUsage.outputTokens,
    cacheCreationInputTokens:
      base.cacheCreationInputTokens + newUsage.cacheCreationInputTokens,
    cacheReadInputTokens:
      base.cacheReadInputTokens + newUsage.cacheReadInputTokens,
    costUsd: parseFloat((base.costUsd + newUsage.costUsd).toFixed(4)),
  };
}

// ---------------------------------------------------------------------------
// GenerationRequest type (DOC-42 §3.1)
// ---------------------------------------------------------------------------

export interface GenerationRequest {
  caseId: string;
  formDefinitionId: string;
  partyId?: string | null;
  isTest?: boolean;
}

// ---------------------------------------------------------------------------
// ExtractionResult type (DOC-42 §2.1)
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  payload: Record<string, unknown>;
  rawText: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// ---------------------------------------------------------------------------
// Sectioned generation helpers (generic long-form engine — generalizes v1)
// ---------------------------------------------------------------------------

/** Native Anthropic web_search tool spec (jurisprudence / country-conditions research). */
export function buildWebSearchTool(
  maxUses: number,
  model?: string,
): { type: "web_search_20250305" | "web_search_20260209"; name: "web_search"; max_uses: number } {
  // Dynamic-filtering variant (better quality) on the models that support it;
  // basic variant elsewhere (e.g. Haiku) where _20260209 isn't available.
  const dynamic = !!model && /^claude-(fable-5|opus-4-[678]|sonnet-4-6)/.test(model);
  return {
    type: dynamic ? "web_search_20260209" : "web_search_20250305",
    name: "web_search",
    max_uses: Math.max(1, Math.min(10, maxUses)),
  };
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).filter(Boolean).length : 0;
}

/** Last `n` words of a text — the "tail" handed to the next section for continuity. */
export function lastWords(text: string, n: number): string {
  const w = text.trim().split(/\s+/).filter(Boolean);
  return w.slice(Math.max(0, w.length - n)).join(" ");
}

/**
 * Builds the per-section user message: base case context + the section's heading,
 * guidance and (optional) the previous section's tail for seamless continuity.
 */
export function buildSectionUserMessage(
  baseUserContent: string,
  section: GenerationSectionSpec,
  prevTail: string,
  researchInstructions?: string | null,
  sectionContext?: string | null,
): string {
  const parts = [baseUserContent, "", `## SECTION TO WRITE NOW: ${section.heading}`];
  if (section.guidance.trim()) parts.push(section.guidance.trim());
  if (section.min_words > 0) parts.push(`Target at least ${section.min_words} words, developed in depth (no filler).`);
  if (researchInstructions && researchInstructions.trim()) parts.push(`Research guidance: ${researchInstructions.trim()}`);
  if (sectionContext && sectionContext.trim()) parts.push("", sectionContext.trim());
  if (prevTail.trim()) {
    parts.push(
      "",
      "<previous_section_tail>",
      prevTail.trim(),
      "</previous_section_tail>",
      "Continue seamlessly from where the previous section ended; do NOT repeat it.",
    );
  }
  parts.push("", "Output ONLY the markdown body of THIS section (no preamble, no other sections).");
  return parts.join("\n");
}

/** Expansion-pass user message when a section came in below its word floor. */
export function buildExpansionUserMessage(sectionUserContent: string, draft: string, floor: number): string {
  return [
    sectionUserContent,
    "",
    `Your previous draft was below the required depth (${floor}+ words). Rewrite it at FULL depth — expand the analysis and detail, do NOT pad with filler or repetition. Your draft to expand:`,
    "",
    draft,
  ].join("\n");
}

/** Default cover title + rows for an immigration memorandum (used when the config
 *  does not define its own — keeps every existing letter working). Values are
 *  {{token}} templates resolved from the case/extraction context. */
export const DEFAULT_COVER_TITLE = "LEGAL MEMORANDUM AND APPLICANT DECLARATION IN SUPPORT OF ASYLUM";
export const DEFAULT_COVER_ROWS: CoverRowSpec[] = [
  { label: "Country of nationality", value: "{{nationality}}" },
  { label: "Court / jurisdiction", value: "{{court}}" },
  { label: "A-Number of principal applicant", value: "{{a_number}}" },
  { label: "Derivative applicant(s) included", value: "{{derivatives}}" },
  { label: "Date of entry into the United States", value: "{{entry_date}}" },
  { label: "Principal theory", value: "{{principal_theory}}" },
];

/** Resolves `{{token}}` placeholders against a flat context map (case data,
 *  document-extraction fields, research analysis). Unknown tokens collapse to ""
 *  so the caller can substitute a placeholder. */
export function resolveTemplate(tpl: string, ctx: Record<string, string | undefined | null>): string {
  return tpl
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
      const v = ctx[key];
      return v != null && String(v).trim() ? String(v).trim() : "";
    })
    .trim();
}

/**
 * Court-grade cover page (title + data table). Both the title and the rows come
 * from the admin-editable config (`cover_page`); each row value is a template
 * resolved from `ctx`. Falls back to the default immigration cover when the config
 * has none. No internal system code or firm/brand identity — the client files pro
 * se, so nothing tying the document to a service provider belongs on page one.
 */
export function buildCoverPage(
  coverCfg: { title?: string; rows?: CoverRowSpec[] } | null | undefined,
  ctx: Record<string, string | undefined | null>,
): string {
  const title = (coverCfg?.title?.trim() || DEFAULT_COVER_TITLE).replace(/\r?\n/g, " ");
  const applicant = String(ctx.applicant_name ?? ctx.full_name ?? "[Applicant]").replace(/\r?\n/g, " ").trim() || "[Applicant]";
  const specs = coverCfg?.rows?.length ? coverCfg.rows : DEFAULT_COVER_ROWS;
  const rows = specs.map((r) => [r.label, resolveTemplate(r.value, ctx) || "—"] as [string, string]);
  const table = ["| Field | Information |", "| --- | --- |", ...rows.map(([k, v]) => `| ${mdCell(k)} | ${mdCell(v)} |`)].join("\n");
  return [`# ${title}`, `## ${applicant}`, "", table].join("\n");
}

/**
 * Builds the "ANNEXES — INDEX OF EXHIBITS" block from the verified research:
 * Exhibit A = federal asylum precedent (holding + factual analogy + source URL);
 * Exhibit B = country-conditions public sources, each with a Guide Note (who said
 * it + short summary + source data) followed by the detailed text and source URL.
 * Empty string when there is nothing verified to annex.
 */
function exhibitTable(rows: Array<[string, string]>): string {
  return [
    "| Field | Information |",
    "| --- | --- |",
    ...rows.filter(([, v]) => v && v.trim()).map(([k, v]) => `| ${mdCell(k)} | ${mdCell(v)} |`),
  ].join("\n");
}

export function buildAnnexesSection(bundle: ResearchBundle): string {
  if (bundle.jurisprudence.length === 0 && bundle.country_conditions.length === 0) return "";
  const out: string[] = [
    "## Annexes — Index of Exhibits",
    "",
    "Each exhibit below is summarized on its own cover sheet (one table per exhibit). In the filed package, each sheet is followed by a complete copy of the underlying authority or report; every public source has a working link so the Court can retrieve and print it.",
  ];
  if (bundle.jurisprudence.length > 0) {
    out.push("", "### Exhibit A — Legal Authorities (Federal Asylum Precedent)");
    bundle.jurisprudence.forEach((c, i) => {
      out.push(
        "",
        `#### Exhibit A-${i + 1}: ${c.name}`,
        "",
        exhibitTable([
          ["Case name", c.name],
          ["Citation", c.citation],
          ["Court / authority", c.court],
          ["Year", c.year],
          ["Holding", c.holding],
          ["Application to the present case", c.factual_analogy],
          ["Public source", c.url || "Citation verified; public copy on file."],
        ]),
      );
    });
  }
  if (bundle.country_conditions.length > 0) {
    out.push("", "### Exhibit B — Country Conditions (Verified Public Sources)");
    bundle.country_conditions.forEach((s, i) => {
      out.push(
        "",
        `#### Exhibit B-${i + 1}: ${s.source_name}`,
        "",
        exhibitTable([
          ["Title of exhibit", s.source_name],
          ["Source / author", s.author || s.source_name],
          ["Date", s.published_date],
          ["Short summary", s.summary],
          ["Why it helps", s.why_it_helps],
          ["Detailed context for the record", s.full_context.trim() ? s.full_context : s.summary],
          ["Link", s.url],
        ]),
      );
    });
  }
  return out.join("\n");
}

/**
 * Page-break sentinel: a standalone marker line that `renderMarkdownToPdf` splits
 * on to start a new physical page (mupdf's HTML engine ignores CSS page-break-*).
 * It is a plain-string contract across the module boundary (pdf.ts cannot import
 * from ai-engine) — the renderer hardcodes the same literal. The DOCX/markdown
 * renderers strip or translate it so it never shows as literal text.
 */
export const PAGE_BREAK = "<<<PAGEBREAK>>>";

/** Blocks that begin on a fresh physical page. The narrative blocks (chronology,
 *  conclusions) flow continuously after the body. */
const PAGE_START_BLOCKS = new Set<AssemblyBlockType>(["cover", "toc", "body", "annexes", "closing"]);

/** Legacy → ordered blocks (used when `assembly.blocks` is absent). Conclusions
 *  stays folded into the body, preserving each pre-existing letter's behavior. */
function defaultAssemblyBlocks(a: AssemblyConfig | null | undefined): AssemblyBlockSpec[] {
  return [
    { type: "cover", enabled: !!a?.cover },
    { type: "toc", enabled: !!a?.toc },
    { type: "body", enabled: true },
    { type: "chronology", enabled: !!a?.chronology },
    { type: "annexes", enabled: !!a?.annexes },
    { type: "closing", enabled: !!(a?.closing && a.closing.trim()) },
  ];
}

/**
 * Assembles section parts into one court-grade markdown document whose STRUCTURE
 * is config-driven: `assembly.blocks` is an ordered, toggleable list of blocks
 * (cover, toc, body, chronology, conclusions, annexes, closing). A `conclusions`
 * block renders the LAST section on its own (the body then renders the rest), so
 * the chronology can sit between the analysis and the conclusion. Page-starting
 * blocks begin a new page (the `<<<PAGEBREAK>>>` sentinel). The cover/chronology/
 * annexes markdown are pre-built by the caller and passed via `extras`; the TOC is
 * generated to mirror the block order. Falls back to the legacy boolean flags when
 * `blocks` is absent.
 */
export function assembleDocument(
  sections: GenerationSectionSpec[],
  parts: string[],
  assembly?: AssemblyConfig | null,
  extras?: { cover?: string; chronology?: string; annexes?: string } | null,
): string {
  const blocks = (assembly?.blocks?.length ? assembly.blocks : defaultAssemblyBlocks(assembly)).filter(
    (b) => b.enabled !== false,
  );

  const splitConclusion = blocks.some((b) => b.type === "conclusions") && parts.length >= 2;
  const bodyParts = splitConclusion ? parts.slice(0, -1) : parts;
  const conclusionPart = splitConclusion ? parts[parts.length - 1] : "";
  const bodyHeadings = splitConclusion ? sections.slice(0, -1) : sections;
  const conclusionHeading = splitConclusion ? sections[sections.length - 1] : null;

  const chronoMd = extras?.chronology?.trim()
    ? ["## Chronological Analysis Table", "", extras.chronology.trim()].join("\n")
    : null;
  const annexesMd = extras?.annexes?.trim() || null;
  const coverMd = extras?.cover?.trim() || null;
  const closingMd =
    assembly?.closing && assembly.closing.trim()
      ? ["## Declaration Under Penalty of Perjury", "", assembly.closing.trim()].join("\n")
      : null;

  // TOC mirrors the block order.
  const tocEntries: string[] = [];
  for (const b of blocks) {
    if (b.type === "body") bodyHeadings.forEach((s) => tocEntries.push(`- ${s.heading}`));
    else if (b.type === "conclusions" && conclusionHeading) tocEntries.push(`- ${conclusionHeading.heading}`);
    else if (b.type === "chronology" && chronoMd) tocEntries.push("- Chronological Analysis Table");
    else if (b.type === "annexes" && annexesMd) tocEntries.push("- Annexes — Index of Exhibits");
    else if (b.type === "closing" && closingMd) tocEntries.push("- Declaration Under Penalty of Perjury");
  }
  const tocMd = ["## Table of Contents", ...tocEntries].join("\n");

  const content = (t: AssemblyBlockType): string | null => {
    switch (t) {
      case "cover": return coverMd;
      case "toc": return tocMd;
      case "body": return bodyParts.length ? bodyParts.join("\n\n") : null;
      case "chronology": return chronoMd;
      case "conclusions": return conclusionPart || null;
      case "annexes": return annexesMd;
      case "closing": return closingMd;
      default: return null;
    }
  };

  const out: string[] = [];
  for (const b of blocks) {
    const md = content(b.type);
    if (!md) continue;
    if (out.length && PAGE_START_BLOCKS.has(b.type)) out.push(PAGE_BREAK);
    out.push(md);
  }
  return out.join("\n\n");
}

// ---------------------------------------------------------------------------
// Chronology (v1's chronological-window engine for the narrative sections)
// ---------------------------------------------------------------------------

/**
 * One row of the case timeline, derived in the research phase from the client's
 * record. Drives both the in-body chronology table and the chronological windows
 * handed to the narrative sections (I.5/I.6/I.7).
 */
export interface ChronologyEvent {
  /** ISO-ish date ("YYYY-MM-DD"); partial values like "2021-05-XX" are allowed. */
  date: string;
  /** What happened and who was involved. */
  event: string;
  /** Direct consequence for the applicant. */
  consequence: string;
  /** Optional exhibit reference (e.g. "A-3"); null when none. */
  exhibit?: string | null;
}

export interface ChronologyWindows {
  early: ChronologyEvent[];
  middle: ChronologyEvent[];
  final: ChronologyEvent[];
}

/**
 * Splits the (chronologically sorted) timeline into three contiguous windows for
 * the three narrative parts. The remainder is **front-loaded** onto the earlier
 * windows (onset/escalation tend to carry more documented incidents than the
 * final flight), mirroring v1's ~3400/3400/2800-word narrative split.
 */
export function splitChronologyWindows(events: ChronologyEvent[]): ChronologyWindows {
  // Sort is stable for full YYYY-MM-DD values. Partial dates like "2021-05-XX"
  // sort lexicographically after the digit characters, so they may not match
  // calendar intent — normalise partials (e.g. "2021-05-01") upstream if exact
  // ordering matters for the narrative.
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;
  const base = Math.floor(n / 3);
  const rem = n % 3;
  const earlyCount = base + (rem >= 1 ? 1 : 0);
  const middleCount = base + (rem >= 2 ? 1 : 0);
  return {
    early: sorted.slice(0, earlyCount),
    middle: sorted.slice(earlyCount, earlyCount + middleCount),
    final: sorted.slice(earlyCount + middleCount),
  };
}

/** Escapes a value for safe inclusion in a markdown table cell (pipes / newlines
 *  in extraction- or AI-derived text would otherwise break the table structure). */
export function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Strips a leading markdown heading the model sometimes echoes back, so the
 * assembled section (which prepends its own `## heading`) never double-prints it.
 */
export function stripLeadingHeading(text: string, expectedHeading?: string): string {
  let t = text.replace(/^\s+/, "");
  // The model sometimes bleeds the previous section's continuity tail into a short
  // orphan lead-in, then re-states its OWN assigned heading (often with cosmetic
  // differences: em-dash vs --, "&" vs "and") before the real content. The assigned
  // heading is prepended separately by the assembler, so when we know the expected
  // heading, cut everything up to and including the echoed copy near the top
  // (orphan fragment + any `---` separator + the duplicate heading line).
  if (expectedHeading) {
    const norm = (s: string) =>
      s.toLowerCase().replace(/[—–]/g, "-").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
    const want = norm(expectedHeading);
    if (want) {
      const headingRe = /^#{1,6}[ \t]([^\n]+?)\s*$/gm;
      let mm: RegExpExecArray | null;
      while ((mm = headingRe.exec(t)) !== null) {
        if (mm.index > 1500) break; // only consider an echo near the top
        const got = norm(mm[1]);
        // Exact (normalized) match only. The real echoes differ from the assigned
        // heading only in cosmetic punctuation (em-dash vs --, & vs and), which the
        // normalizer already squashes — so an exact match catches them. A prefix
        // match would silently drop a legitimate intro paragraph whenever a section
        // has a subheading that is a prefix of its title (e.g. "## Legal" under a
        // "Legal Analysis" section), so it is deliberately NOT used.
        if (got === want) {
          // Cut up to and including the echoed heading and return — do NOT fall
          // through to the leading-heading strip, which would eat the section's
          // first legitimate subheading now sitting on top.
          return t.slice(mm.index + mm[0].length).replace(/^\s+/, "");
        }
      }
    }
  }
  // Strip a leading heading line (the clean case, or any heading still left on top).
  const m = t.match(/^#{1,6}[ \t][^\n]*\n+/);
  return m ? t.slice(m[0].length) : t;
}

/** Renders the timeline as a markdown table (empty string when there are no events). */
export function buildChronologyTable(events: ChronologyEvent[]): string {
  if (events.length === 0) return "";
  const header = "| Date | Event & Parties Involved | Direct Consequences | Exhibit |";
  const divider = "| --- | --- | --- | --- |";
  const rows = events.map(
    (e) =>
      `| ${mdCell(e.date)} | ${mdCell(e.event)} | ${mdCell(e.consequence)} | ${e.exhibit && e.exhibit.trim() ? mdCell(e.exhibit) : "—"} |`,
  );
  return [header, divider, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Research phase (v1's two-phase pipeline: structured analysis + verified
// jurisprudence + country conditions gathered ONCE, persisted, and injected into
// EVERY section so citations are consistent). The machinery here is generic; the
// domain-specific guidance (system_prompt + research_instructions) comes from the
// config, editable in the admin form-editor — never hardcoded.
// ---------------------------------------------------------------------------

export interface ResearchAnalysis {
  nationality: string;
  persecution_type: string;
  protected_grounds: string[];
  perpetrator: string;
  state_action: string;
  /** One-line theory of the case — drives the cover page. */
  principal_theory: string;
  /** Narrative summary used to seed the research queries. */
  summary: string;
  chronology: ChronologyEvent[];
}

export interface JurisprudenceCase {
  name: string;
  citation: string;
  court: string;
  year: string;
  holding: string;
  factual_analogy: string;
  url: string;
}

export interface CountryConditionSource {
  source_name: string;
  author: string;
  summary: string;
  full_context: string;
  why_it_helps: string;
  url: string;
  published_date: string;
}

/** Persisted in `ai_generation_runs.research`; also the feedstock for the annexes. */
export interface ResearchBundle {
  analysis: ResearchAnalysis | null;
  jurisprudence: JurisprudenceCase[];
  country_conditions: CountryConditionSource[];
}

// -- tolerant coercion helpers (model output is untrusted/loosely-shaped) ------

function rstr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}
function rrec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function rarr(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}
/** First array-valued property among `keys` (tolerant of wrapper-key variation). */
function rarrProp(rec: Record<string, unknown> | null, keys: string[]): unknown[] | null {
  if (!rec) return null;
  for (const k of keys) {
    const a = rarr(rec[k]);
    if (a) return a;
  }
  return null;
}
/** Returns the first balanced `{…}`/`[…]` span (string-aware), ignoring trailing prose. */
function extractBalanced(text: string): string | undefined {
  const firstObj = text.indexOf("{");
  const firstArr = text.indexOf("[");
  if (firstObj === -1 && firstArr === -1) return undefined;
  const useArr = firstArr !== -1 && (firstObj === -1 || firstArr < firstObj);
  const open = useArr ? "[" : "{";
  const close = useArr ? "]" : "}";
  const start = useArr ? firstArr : firstObj;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

/**
 * Extracts a JSON value from a model response that may wrap it in a ```json fence
 * or surrounding prose. Returns null when no JSON can be recovered.
 */
export function extractJson(text: string): unknown {
  if (!text) return null;
  const candidates: string[] = [];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(m[1]);
  candidates.push(text);
  for (const c of candidates) {
    const parsed = tryParseJsonLoose(c);
    if (parsed !== undefined) return parsed;
  }
  return null;
}

function tryParseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to balanced-span extraction */
  }
  const balanced = extractBalanced(trimmed);
  if (balanced !== undefined) {
    try {
      return JSON.parse(balanced);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Parses the structured analysis (E1-E8 + chronology); null when unrecoverable. */
export function parseResearchAnalysis(text: string): ResearchAnalysis | null {
  const r = rrec(extractJson(text));
  if (!r) return null;
  const nationality = rstr(r.nationality);
  const summary = rstr(r.summary);
  const chronoRaw = rarr(r.chronology);
  if (!nationality && !summary && !chronoRaw) return null;
  const chronology: ChronologyEvent[] = (chronoRaw ?? [])
    .map(rrec)
    .filter((e): e is Record<string, unknown> => e !== null)
    .map((e) => ({
      date: rstr(e.date),
      event: rstr(e.event),
      consequence: rstr(e.consequence),
      exhibit: e.exhibit != null ? rstr(e.exhibit) : null,
    }));
  return {
    nationality,
    persecution_type: rstr(r.persecution_type),
    protected_grounds: (rarr(r.protected_grounds) ?? []).map(rstr).filter(Boolean),
    perpetrator: rstr(r.perpetrator),
    state_action: rstr(r.state_action),
    principal_theory: rstr(r.principal_theory),
    summary,
    chronology,
  };
}

/** Parses verified jurisprudence; accepts `{cases:[…]}` or a bare array. */
export function parseJurisprudence(text: string): JurisprudenceCase[] {
  const json = extractJson(text);
  const arr = rarr(json) ?? rarrProp(rrec(json), ["cases", "precedents", "results"]);
  if (!arr) return [];
  const out: JurisprudenceCase[] = [];
  for (const raw of arr) {
    const r = rrec(raw);
    if (!r) continue;
    const name = rstr(r.name ?? r.case_name ?? r.title);
    const citation = rstr(r.citation);
    if (!name || !citation) continue;
    out.push({
      name,
      citation,
      court: rstr(r.court),
      year: rstr(r.year),
      holding: rstr(r.holding),
      factual_analogy: rstr(r.factual_analogy ?? r.factual_analogy_to_applicant),
      url: rstr(r.url),
    });
  }
  return out;
}

/** Parses verified country-conditions sources; accepts `{items:[…]}` or a bare array. */
export function parseCountryConditions(text: string): CountryConditionSource[] {
  const json = extractJson(text);
  const arr = rarr(json) ?? rarrProp(rrec(json), ["items", "sources", "country_conditions", "results"]);
  if (!arr) return [];
  const out: CountryConditionSource[] = [];
  for (const raw of arr) {
    const r = rrec(raw);
    if (!r) continue;
    const source_name = rstr(r.source_name ?? r.source ?? r.name ?? r.outlet ?? r.publication);
    if (!source_name) continue;
    out.push({
      source_name,
      author: rstr(r.author),
      summary: rstr(r.summary ?? r.executive_summary ?? r.excerpt),
      full_context: rstr(r.full_context ?? r.context),
      why_it_helps: rstr(r.why_it_helps),
      url: rstr(r.url),
      published_date: rstr(r.published_date ?? r.date),
    });
  }
  return out;
}

function analysisSummaryText(a: ResearchAnalysis): string {
  return [
    `Nationality: ${a.nationality}`,
    `Persecution type: ${a.persecution_type}`,
    `Protected grounds: ${a.protected_grounds.join(", ")}`,
    `Perpetrator: ${a.perpetrator}`,
    `State action: ${a.state_action}`,
    `Summary: ${a.summary}`,
  ].join("\n");
}

/**
 * Renders the verified research as a markdown block appended ONCE to the case
 * context. Sections may cite ONLY from here (rule R4). Empty when nothing verified.
 */
export function buildResearchContextBlock(bundle: ResearchBundle): string {
  const parts: string[] = [];
  // Each source is labeled by the EXHIBIT TAB it will be filed under (jurisprudence
  // → Exhibit A-n, country conditions → Exhibit B-n) — the SAME order the exhibits
  // module uses when it downloads and indexes them (exhibits/domain collectSources).
  // The body cites these tabs inline ("see Exhibit A-1") instead of reproducing a
  // full exhibit table, which the expediente's Index of Exhibits provides.
  if (bundle.jurisprudence.length > 0) {
    parts.push("<verified_jurisprudence>");
    bundle.jurisprudence.forEach((c, i) => {
      parts.push(
        `Exhibit A-${i + 1}: ${c.name} — ${c.citation}${c.court ? ` (${c.court}${c.year ? `, ${c.year}` : ""})` : ""}`,
        `   Holding: ${c.holding}`,
        `   Factual analogy: ${c.factual_analogy}`,
        ...(c.url ? [`   Source: ${c.url}`] : []),
      );
    });
    parts.push("</verified_jurisprudence>");
  }
  if (bundle.country_conditions.length > 0) {
    if (parts.length) parts.push("");
    parts.push("<country_conditions>");
    bundle.country_conditions.forEach((s, i) => {
      parts.push(
        `Exhibit B-${i + 1}: ${s.source_name}${s.published_date ? ` (${s.published_date})` : ""}: ${s.summary}`,
        `   Why it helps: ${s.why_it_helps}`,
        ...(s.url ? [`   Source: ${s.url}`] : []),
      );
    });
    parts.push("</country_conditions>");
  }
  if (parts.length === 0) return "";
  return [
    "## VERIFIED RESEARCH (cite ONLY from here — never fabricate)",
    "Each source below is an EXHIBIT filed with the record. When you rely on a source, cite it inline by its exhibit tab (e.g., \"see Exhibit A-1\", \"as Exhibit B-2 documents\"). Do NOT reproduce an exhibit table or index in the memorandum — the exhibits are filed and indexed separately.",
    "",
    ...parts,
  ].join("\n");
}

/** Analysis-phase prompt: folds the admin `system_prompt` over a generic JSON contract. */
export function buildAnalysisPrompt(args: { systemPrompt: string; caseContext: string }): {
  system: string;
  user: string;
} {
  const system = [
    args.systemPrompt.trim(),
    "",
    "You are now in the ANALYSIS phase. Read the client's record and produce a STRUCTURED JSON analysis — no prose outside the JSON.",
    'Output ONLY a JSON object with these keys: { "nationality": string, "persecution_type": string, "protected_grounds": string[], "perpetrator": string, "state_action": string, "principal_theory": string, "summary": string, "chronology": [{ "date": "YYYY-MM-DD", "event": string, "consequence": string, "exhibit": string|null }] }',
    "Trace every fact to the record; never invent. Order the chronology earliest→latest.",
  ].join("\n");
  const user = ["<case_record>", args.caseContext, "</case_record>", "", "Produce the structured analysis JSON now."].join("\n");
  return { system, user };
}

/** Jurisprudence-search prompt: generic web_search + strict-JSON contract + admin instructions. */
export function buildJurisprudencePrompt(args: { instructions: string | null; analysis: ResearchAnalysis | null }): {
  system: string;
  user: string;
} {
  const system = [
    "You are a Senior Federal Immigration Attorney. Use the web_search tool to find REAL, verified, favorable published precedents. NEVER fabricate a case, citation, holding or URL — every case must trace to a search result with a working source link.",
    'Output ONLY strict JSON, no prose, no code fences: { "cases": [ { "name": string, "citation": string, "court": string, "year": string, "holding": string, "factual_analogy_to_applicant": string, "url": string } ] }',
    "After completing your web searches, your FINAL message must be the JSON object and nothing else — no narration, no commentary, no text before or after it.",
  ].join("\n");
  const user = [
    args.instructions?.trim() || "Find favorable, verified federal precedents matched to the applicant's profile.",
    "",
    args.analysis ? `<applicant_profile>\n${analysisSummaryText(args.analysis)}\n</applicant_profile>` : "",
    "Return the JSON now.",
  ].join("\n");
  return { system, user };
}

/** Country-conditions prompt: generic web_search + strict-JSON contract + admin instructions. */
export function buildCountryConditionsPrompt(args: { instructions: string | null; analysis: ResearchAnalysis | null }): {
  system: string;
  user: string;
} {
  const system = [
    "You are a Senior Federal Immigration Attorney assembling corroborating country-conditions sources. Use web_search to find recent, verified, reputable reporting (HRW, U.S. State Department, major outlets). NEVER fabricate a source, quote, statistic or URL.",
    'Output ONLY strict JSON, no prose, no code fences: { "items": [ { "source_name": string, "author": string, "executive_summary": string, "full_context": string, "why_it_helps": string, "url": string, "published_date": string } ] }',
    "After completing your web searches, your FINAL message must be the JSON object and nothing else — no narration, no commentary, no text before or after it.",
  ].join("\n");
  const user = [
    args.instructions?.trim() || "Find recent country-conditions reporting corroborating the applicant's claim.",
    "",
    args.analysis ? `<applicant_profile>\n${analysisSummaryText(args.analysis)}\n</applicant_profile>` : "",
    "Return the JSON now.",
  ].join("\n");
  return { system, user };
}

// ---------------------------------------------------------------------------
// Jurisprudence from the curated dataset (reliable; replaces the flaky open-ended
// web_search for case law — web_search hangs/returns nothing when asked to find
// "6-10 published federal precedents", but the curated dataset already holds real
// precedents with citations + holdings + a denial-reason taxonomy in tags).
// ---------------------------------------------------------------------------

/** Citation patterns: 480 U.S. 421 · 217 F.3d 646 · 45 F.4th 192 · 19 I&N Dec. 211. */
const CITATION_RE = /(\d+\s+(?:U\.S\.|S\.\s?Ct\.|L\.\s?Ed\.\s?\d?d?|F\.\s?\d+(?:th|d)|F\.\s?Supp\.\s?\d?d?|I&N\s+Dec\.)\s+\d+)/;
/** Normalizes a tag for overlap matching: strips diacritics (so "persecución" and
 *  "persecucion" match) before ASCII-folding. */
const normTag = (s: string) =>
  s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Maps a dataset item to a JurisprudenceCase exhibit (analogy filled in later).
 *  Returns null for non-precedent items (NGO models, country sources). */
export function parsePrecedent(item: DatasetItem): JurisprudenceCase | null {
  const meta = item.meta ?? {};
  if (meta.kind === "country" || meta.kind === "model" || item.outcome === "model") return null;
  const title = item.title ?? "";
  const citation = (meta.citation ?? "").trim() || title.match(CITATION_RE)?.[1] || item.content?.match(CITATION_RE)?.[1] || "";
  if (!citation && meta.kind !== "precedent") return null; // not clearly a precedent
  const year = (meta.year ?? "").trim() || title.match(/\((?:[^)]*?\s)?(\d{4})\)/)?.[1] || "";
  const court = (meta.court ?? "").trim() || item.jurisdiction || "";
  let name = title.replace(CITATION_RE, "").replace(/\([^)]*\d{4}\)/g, "").replace(/[,\s]+$/g, "").replace(/\s{2,}/g, " ").trim();
  if (!name) name = title.trim();
  return { name, citation, court, year, holding: (meta.holding ?? "").trim() || (item.content ?? "").trim(), factual_analogy: "", url: (meta.url ?? "").trim() };
}

/** Selects the most relevant precedents from the dataset for the applicant's profile
 *  (tag overlap with persecution type + protected grounds, preferring granted). */
export function datasetToJurisprudence(items: DatasetItem[], analysis: ResearchAnalysis | null, max = 6): JurisprudenceCase[] {
  const ctx = analysis ? [analysis.persecution_type, ...(analysis.protected_grounds ?? [])].filter(Boolean).map(normTag) : [];
  const scored = items
    .map((it) => ({ it, cas: parsePrecedent(it) }))
    .filter((x): x is { it: DatasetItem; cas: JurisprudenceCase } => x.cas !== null)
    .map(({ it, cas }) => ({
      cas,
      overlap: it.tags.map(normTag).filter((t) => ctx.includes(t)).length,
      // Favorable = granted or remanded (appeal wins are remands, not grants).
      granted: it.outcome === "granted" || it.outcome === "remanded" ? 1 : 0,
      created: it.created_at,
    }));
  scored.sort((a, b) => b.overlap - a.overlap || b.granted - a.granted || b.created.localeCompare(a.created));
  return scored.slice(0, max).map((s) => s.cas);
}

/** Prompt to generate a per-precedent factual analogy to THIS applicant (no tools;
 *  reliable, unlike the web_search case-law search). */
export function buildJurisprudenceAnalogyPrompt(args: { analysis: ResearchAnalysis | null; cases: JurisprudenceCase[] }): {
  system: string;
  user: string;
} {
  const system = [
    "You are a Senior Federal Immigration Attorney. For each precedent, write ONE concise, persuasive paragraph APPLYING its holding to THIS applicant's specific facts (the factual analogy) — do not merely restate the holding.",
    'Output ONLY strict JSON, no prose, no code fences: { "analogies": [ { "i": number, "factual_analogy": string } ] } where i is the 1-based precedent index.',
  ].join("\n");
  const caseList = args.cases
    .map((c, i) => `${i + 1}. ${c.name}${c.citation ? `, ${c.citation}` : ""} — Holding: ${c.holding}`)
    .join("\n");
  const user = [
    args.analysis ? `<applicant_profile>\n${analysisSummaryText(args.analysis)}\n</applicant_profile>` : "",
    "<precedents>",
    caseList,
    "</precedents>",
    "Return the JSON now — exactly one factual_analogy per precedent index.",
  ].join("\n");
  return { system, user };
}

/** Maps dataset items explicitly tagged as country-condition sources (meta.kind ===
 *  "country") to CountryConditionSource exhibits — the fallback used when the
 *  web_search country pass yields nothing, so the annexes are never empty. */
export function datasetToCountry(items: DatasetItem[], max = 6): CountryConditionSource[] {
  return items
    .filter((it) => it.meta?.kind === "country")
    .slice(0, max)
    .map((it) => ({
      source_name: it.title,
      author: (it.meta?.court ?? "").trim(),
      summary: (it.content ?? "").slice(0, 400).trim(),
      full_context: (it.content ?? "").trim(),
      why_it_helps: "Corroborates the documented country conditions relevant to the applicant's claim.",
      url: (it.meta?.url ?? "").trim(),
      published_date: (it.meta?.year ?? "").trim(),
    }));
}

/** Parses the analogy JSON into an array aligned to the precedent order. */
export function parseAnalogies(text: string, count: number): string[] {
  const out: string[] = new Array(count).fill("");
  const json = extractJson(text) as { analogies?: unknown[]; items?: unknown[] } | unknown[] | null;
  const arr = Array.isArray(json) ? json : (json?.analogies ?? json?.items ?? []);
  if (!Array.isArray(arr)) return out;
  for (const a of arr as Array<Record<string, unknown>>) {
    const i = Number(a?.i ?? a?.index);
    const txt = String(a?.factual_analogy ?? a?.analogy ?? "").trim();
    if (Number.isInteger(i) && i >= 1 && i <= count && txt) out[i - 1] = txt;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Form segmentation (AI propose) — pure helper: drop clearly-internal fields so
// the model's OUTPUT budget is spent on real client questions (not signatures,
// barcodes, office-use, etc.). Input size is not the bottleneck; output is.
// ---------------------------------------------------------------------------

/**
 * Field names that are NEVER client-answerable (signatures, preparer/interpreter/
 * attorney blocks, barcodes, page numbers, office-use). Dropped before proposing
 * so the token budget is spent on real questions (the v1 curated-field-map spirit).
 * Conservative on purpose — only clearly-internal terms, to avoid dropping real fields.
 * Field names use underscores heavily (e.g. "Attorney_StateBar") and `_` is a word
 * char, so `\b` is unreliable here — use plain substrings where safe.
 */
const INTERNAL_FIELD_RE =
  /(signature|preparer|interpreter|attorney|g-?28|barcode|bar_code|pdf417|qrcode|page[\s_-]?(number|no\b)|uscis\s*use|official\s*use|notary|date\s*of\s*signature)/i;

export function curateInternalFields<T extends { name: string }>(
  fields: T[],
): { kept: T[]; dropped: number } {
  const kept = fields.filter((f) => !INTERNAL_FIELD_RE.test(f.name ?? ""));
  return { kept, dropped: fields.length - kept.length };
}
