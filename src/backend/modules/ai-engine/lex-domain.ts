/**
 * ai-engine module — Lex case chat: pure domain logic (no I/O).
 *
 * Lex is the staff-only per-case AI chat (case workspace "Lex" tab): its
 * knowledge is ONLY the case (RAG over `case_knowledge_chunks` — fed by
 * document_extractions.raw_text + case_form_responses.answers + a factual case
 * profile), plus a service-scoped web search. Everything here is deterministic
 * given its inputs; the lex-service layer orchestrates I/O.
 *
 * Key references:
 *   Migration 0093_lex_case_chat.sql (tables + match_case_knowledge RPC + RLS)
 *   DOC-74 §5.2 (cost formula — reused via domain.ts), §7.1 (PII masking)
 *
 * @module ai-engine/lex-domain
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Source kinds (mirror the DB check constraint in 0093_lex_case_chat.sql)
// ---------------------------------------------------------------------------

export const LEX_SOURCE_KINDS = [
  "document_extraction",
  "form_response",
  "case_profile",
] as const;
export type LexSourceKind = (typeof LEX_SOURCE_KINDS)[number];

// ---------------------------------------------------------------------------
// View models (contract with the frontend — do not change lightly)
// ---------------------------------------------------------------------------

/** A citation attached to an assistant message: a case chunk (by human label)
 *  or a web result (by URI). Serialized verbatim into case_lex_messages.sources. */
export type LexSource =
  | { kind: "chunk"; label: string }
  | { kind: "web"; uri: string; title: string | null };

export type LexMessageStatus = "running" | "completed" | "failed";

export interface LexMessageVM {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: LexMessageStatus;
  sources: LexSource[];
  createdAt: string;
}

export interface LexThreadVM {
  /** null when the staff member has never chatted on this case (lazy thread). */
  threadId: string | null;
  messages: LexMessageVM[];
}

// ---------------------------------------------------------------------------
// Models (admin-configurable per org: orgs.settings.ai_lex_model)
// ---------------------------------------------------------------------------

export const LEX_MODELS = [
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-fable-5",
] as const;
export type LexModel = (typeof LEX_MODELS)[number];

/** Default when neither orgs.settings.ai_lex_model nor env AI_LEX_MODEL is set. */
export const DEFAULT_LEX_MODEL: LexModel = "claude-sonnet-4-6";

/** Type guard for settings/env values — invalid values fall back to the default. */
export function isLexModel(value: unknown): value is LexModel {
  return typeof value === "string" && (LEX_MODELS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Chunking (DOC-26 §2.1 style: paragraph splits, hard char cap, unicode-safe)
// ---------------------------------------------------------------------------

export const LEX_CHUNK_MAX_CHARS = 3200;
export const LEX_CHUNK_OVERLAP_CHARS = 400;

/**
 * Hard-splits a single over-cap paragraph by CODE POINTS (never slices a
 * surrogate pair), keeping `overlapChars` of context between consecutive slices.
 */
function splitByCodePoints(text: string, maxChars: number, overlapChars: number): string[] {
  const chars = [...text];
  const step = Math.max(1, maxChars - overlapChars);
  const out: string[] = [];
  for (let start = 0; start < chars.length; start += step) {
    const slice = chars.slice(start, start + maxChars).join("");
    if (slice.trim()) out.push(slice);
    if (start + maxChars >= chars.length) break;
  }
  return out;
}

/**
 * Tail of the previous chunk used to seed the next one (context overlap).
 * Starts at the first whitespace inside the tail window so the overlap does
 * not begin mid-word; code-point safe.
 */
function overlapTail(text: string, overlapChars: number): string {
  const tail = [...text].slice(-overlapChars).join("");
  const boundary = tail.search(/\s/);
  if (boundary < 0) return tail; // single long token — keep as-is
  return tail.slice(boundary + 1);
}

/**
 * Splits a source text into embedding-ready chunks.
 *
 * Strategy: split on paragraph boundaries (blank lines) and pack paragraphs
 * greedily under `maxChars`; a paragraph that alone exceeds the cap is hard-cut
 * by code points (unicode-safe). Consecutive chunks share up to `overlapChars`
 * of tail context. Returns [] for empty input.
 */
export function chunkText(
  text: string,
  maxChars: number = LEX_CHUNK_MAX_CHARS,
  overlapChars: number = LEX_CHUNK_OVERLAP_CHARS,
): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const paragraphs = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Normalize to units that individually fit under the cap.
  const units: string[] = [];
  for (const p of paragraphs) {
    if ([...p].length <= maxChars) {
      units.push(p);
    } else {
      units.push(...splitByCodePoints(p, maxChars, overlapChars));
    }
  }

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if ([...candidate].length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    const tail = current ? overlapTail(current, overlapChars) : "";
    const seeded = tail ? `${tail}\n\n${unit}` : unit;
    // The unit alone always fits; only seed the overlap when it keeps the cap.
    current = [...seeded].length <= maxChars ? seeded : unit;
  }
  if (current) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// Content hashing (incremental reindex: same hash = no re-embed)
// ---------------------------------------------------------------------------

/** sha-256 hex of the chunk content — stored in case_knowledge_chunks.content_hash. */
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Case profile (indexed as chunk source_kind='case_profile', source_id=case_id)
// ---------------------------------------------------------------------------

export interface LexCaseProfileInput {
  caseNumber: string;
  serviceName: string;
  planName: string | null;
  currentPhase: string | null;
  status: string;
  currentStage: string;
  parties: Array<{ role: string; name: string }>;
}

/**
 * Compact factual summary of the case. Staff-facing (the Lex tab is internal),
 * so it is written in Spanish. Facts only — no inference.
 */
export function buildCaseProfile(input: LexCaseProfileInput): string {
  const lines = [
    `Caso: ${input.caseNumber}`,
    `Servicio: ${input.serviceName}`,
  ];
  if (input.planName) lines.push(`Plan: ${input.planName}`);
  if (input.currentPhase) lines.push(`Fase actual: ${input.currentPhase}`);
  lines.push(`Estado: ${input.status}`, `Etapa: ${input.currentStage}`);
  if (input.parties.length > 0) {
    lines.push("Partes:");
    for (const p of input.parties) lines.push(`- ${p.name} (${p.role})`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Lex system prompt. Hard scope rules:
 *   - ONLY answers about THIS case, from the retrieved context (the single
 *     source of truth — inventing case facts is forbidden).
 *   - General/off-case questions (definitions, jokes, other areas) get a polite
 *     1-2 sentence refusal redirecting to the case.
 *   - web_search is allowed ONLY for service context (USCIS/EOIR requirements,
 *     official forms, processing times) — never for case facts.
 *   - Case sources are cited by their label; answer in the staff's language.
 */
export function buildLexSystemPrompt(opts: { serviceName: string; locale: "es" | "en" }): string {
  const { serviceName, locale } = opts;
  if (locale === "en") {
    return [
      `You are Lex, the internal assistant of the USA Latino staff. You answer questions from the legal team about ONE specific case (service: ${serviceName}).`,
      "",
      "SCOPE RULES (never violate):",
      "1. You ONLY answer about THIS case. The retrieved case context below is the ONLY source of facts: NEVER invent facts, dates, names or events about the case — if the context does not contain the answer, say so plainly.",
      "2. If the question is general or unrelated to this case (definitions, jokes, other legal areas, small talk), politely refuse in 1-2 sentences and redirect to the case.",
      `3. Use web_search ONLY for context about the service (${serviceName}): official USCIS/EOIR requirements, official forms, processing times. Never use it for case facts.`,
      "4. Cite the case sources you rely on by their label (the names in parentheses of each fragment).",
      "5. Answer in English, in a professional and concise tone.",
    ].join("\n");
  }
  return [
    `Eres Lex, el asistente interno del staff de USA Latino. Respondes preguntas del equipo legal sobre UN caso concreto (servicio: ${serviceName}).`,
    "",
    "REGLAS DE ALCANCE (nunca las violes):",
    "1. SOLO respondes sobre ESTE caso. El contexto recuperado del caso (abajo) es la ÚNICA fuente de hechos: PROHIBIDO inventar hechos, fechas, nombres o eventos del caso — si el contexto no contiene la respuesta, dilo claramente.",
    "2. Si la pregunta es general o ajena a este caso (definiciones, chistes, otras áreas legales, charla), rechaza cortésmente en 1-2 frases y redirige al caso.",
    `3. Usa web_search SOLO para contexto del servicio (${serviceName}): requisitos oficiales USCIS/EOIR, formularios oficiales, tiempos de procesamiento. Nunca para hechos del caso.`,
    "4. Cita las fuentes del caso en que te apoyes por su etiqueta (el nombre entre paréntesis de cada fragmento).",
    "5. Responde en español, con tono profesional y conciso.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Form answers document (indexed as chunks source_kind='form_response')
// ---------------------------------------------------------------------------

/** Renders one answer value for the Q/A document; "" means "skip" (empty). */
function renderAnswerValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => renderAnswerValue(v))
      .filter(Boolean)
      .join(", ");
  }
  // Nested objects are rare in answers; keep a compact JSON form.
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * Renders a submitted form response as "P: <question label>\nR: <answer>" lines.
 * `answers` is keyed by question id; `questionLabels` maps id → human label
 * (falls back to the raw id when unknown). Unanswered/empty answers are skipped.
 */
export function buildAnswersDocument(
  answers: Record<string, unknown>,
  questionLabels: Record<string, string>,
): string {
  const lines: string[] = [];
  for (const [questionId, raw] of Object.entries(answers)) {
    const value = renderAnswerValue(raw);
    if (!value) continue;
    const label = questionLabels[questionId]?.trim() || questionId;
    lines.push(`P: ${label}`, `R: ${value}`, "");
  }
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Row → view model mapping
// ---------------------------------------------------------------------------

/** Row shape consumed from the repository (case_lex_messages). */
export interface LexMessageRowLike {
  id: string;
  role: string;
  content: string;
  status: string;
  sources: unknown;
  created_at: string;
}

/** Defensive parse of the sources jsonb into the LexSource union. */
export function parseLexSources(raw: unknown): LexSource[] {
  if (!Array.isArray(raw)) return [];
  const out: LexSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    if (s.kind === "chunk" && typeof s.label === "string") {
      out.push({ kind: "chunk", label: s.label });
    } else if (s.kind === "web" && typeof s.uri === "string") {
      out.push({ kind: "web", uri: s.uri, title: typeof s.title === "string" ? s.title : null });
    }
  }
  return out;
}

/** Maps a case_lex_messages row to its view model. */
export function mapRowToMessageVM(row: LexMessageRowLike): LexMessageVM {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    status:
      row.status === "running" || row.status === "failed" ? row.status : "completed",
    sources: parseLexSources(row.sources),
    createdAt: row.created_at,
  };
}
