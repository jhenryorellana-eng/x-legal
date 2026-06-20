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
].join("\n");

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
  assembly?: { cover?: boolean; toc?: boolean; closing?: string | null } | null;
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

export interface DatasetItem {
  id: string;
  title: string;
  content: string | null;
  tags: string[];
  outcome: string | null;
  token_count: number; // already filtered: never null when passed to selectDatasetItems
  created_at: string;
  jurisdiction: string | null;
}

// ---------------------------------------------------------------------------
// Prompt assembly inputs
// ---------------------------------------------------------------------------

export interface ResolvedInputs {
  documents: Array<{
    slug: string;
    extractionPayload: Record<string, unknown>;
    rawText: string;
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
  // claude-opus-4-7: F4-1 premium option per Henry; if invalid at runtime, ops uses claude-opus-4-8
  "claude-opus-4-7": {
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
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
    const outcomeScore = item.outcome === "granted" ? 1 : 0;
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
function buildUserMessage(
  snapshot: ConfigSnapshot,
  inputs: ResolvedInputs,
  outputLanguage?: string,
): string {
  const parts: string[] = [];

  // 1. CASE CONTEXT — extractions payload (field-by-field, labeled by slug)
  if (inputs.documents.length > 0) {
    parts.push("## DATOS EXTRAÍDOS DE DOCUMENTOS");
    for (const doc of inputs.documents) {
      parts.push(`\n### Documento: ${doc.slug}`);
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
    for (const doc of inputs.documents) {
      parts.push(`\n--- INICIO DOCUMENTO: ${doc.slug} ---`);
      parts.push(maskPii(doc.rawText));
      parts.push(`--- FIN DOCUMENTO: ${doc.slug} ---`);
    }
  }

  // 4. FORMAT/LANGUAGE INSTRUCTIONS (fixed platform block)
  const lang = outputLanguage ?? snapshot.output_language ?? "es";
  parts.push("\n## INSTRUCCIONES DE FORMATO Y IDIOMA");
  parts.push(buildFormatInstructions(lang, snapshot.max_output_tokens));

  return parts.join("\n");
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
): { type: "web_search_20250305"; name: "web_search"; max_uses: number } {
  return { type: "web_search_20250305", name: "web_search", max_uses: Math.max(1, Math.min(10, maxUses)) };
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
): string {
  const parts = [baseUserContent, "", `## SECTION TO WRITE NOW: ${section.heading}`];
  if (section.guidance.trim()) parts.push(section.guidance.trim());
  if (section.min_words > 0) parts.push(`Target at least ${section.min_words} words, developed in depth (no filler).`);
  if (researchInstructions && researchInstructions.trim()) parts.push(`Research guidance: ${researchInstructions.trim()}`);
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

/** Assembles section parts into one markdown document (optional TOC + closing). */
export function assembleDocument(
  sections: GenerationSectionSpec[],
  parts: string[],
  assembly?: { cover?: boolean; toc?: boolean; closing?: string | null } | null,
): string {
  const out: string[] = [];
  if (assembly?.toc) {
    out.push(["## Index", ...sections.map((s) => `- ${s.heading}`)].join("\n"), "");
  }
  out.push(parts.join("\n\n"));
  if (assembly?.closing && assembly.closing.trim()) {
    out.push("", "---", "", assembly.closing.trim());
  }
  return out.join("\n\n");
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
