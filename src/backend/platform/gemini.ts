/**
 * Google Gemini client — DOC-74 §3.1.
 *
 * Single SDK instance for T3 (document extraction) and T4 (translation).
 * No module imports `@google/genai` directly — all Gemini calls go through
 * `ai-engine` (F4), which is the only consumer (DOC-27 §7.1, RNF-041).
 *
 * Note on retries (DOC-74 §3.1): unlike the Anthropic SDK, `@google/genai`
 * does NOT retry automatically. The ai-engine layer implements 3 retries with
 * exponential backoff for 429 (RESOURCE_EXHAUSTED) and 5xx/503 — below the
 * QStash retry layer.
 *
 * Default model: `gemini-2.5-flash` (overridable via AI_GEMINI_MODEL env).
 * Verified pricing June 2026: $0.30/$2.50 per MTok input/output.
 */

import { GoogleGenAI } from "@google/genai";
import { providerEnv } from "./env.js";

// ---------------------------------------------------------------------------
// Model constants (DOC-74 §3.2)
// ---------------------------------------------------------------------------

/** Default model for T3/T4 tasks. Override via AI_GEMINI_MODEL env var. */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

// ---------------------------------------------------------------------------
// Client factory (lazy singleton)
// ---------------------------------------------------------------------------

let _client: GoogleGenAI | null = null;

/**
 * Returns the Google Generative AI SDK instance.
 * Validates GEMINI_API_KEY on first access (requires paid tier — DOC-74 §7.2).
 */
export function getGeminiClient(): GoogleGenAI {
  if (!_client) {
    const genv = providerEnv("gemini");
    _client = new GoogleGenAI({ apiKey: genv.GEMINI_API_KEY });
  }
  return _client;
}

/**
 * Returns the `models` namespace from the GoogleGenAI client.
 *
 * The ai-engine module calls this to invoke `models.generateContent(...)` per
 * job run. The model name is passed per-call (default: gemini-2.5-flash).
 * Configuration (temperature, maxOutputTokens, responseMimeType, responseSchema)
 * is specified at the call site in ai-engine (DOC-74 §3.2).
 *
 * @example
 *   const response = await getGeminiModels().generateContent({
 *     model: DEFAULT_GEMINI_MODEL,
 *     contents: [...],
 *     config: { temperature: 0, maxOutputTokens: 8192 },
 *   });
 */
export function getGeminiModels() {
  return getGeminiClient().models;
}
