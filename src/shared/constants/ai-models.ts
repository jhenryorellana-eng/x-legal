/**
 * Whitelist of AI generation models allowed in ai_generation_configs.
 * Source: DOC-74 §1 / RF-ADM-036 (model selector).
 *
 * F4-1 additions (Henry's decision):
 *   - claude-opus-4-7  — premium selectable via catalog editor (if not valid at runtime, use claude-opus-4-8)
 *   - claude-sonnet-4-6 — default for legal generation in F4-1
 *   - claude-fable-5   — kept; remains T1 default per DOC-74 §1
 *   - claude-haiku-4-5 — lightweight tasks (T5, summaries)
 */
export const GENERATION_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-7", // premium option — if invalid at runtime, operator may swap to claude-opus-4-8
  "claude-fable-5",
  "claude-haiku-4-5",
] as const;

export type GenerationModel = (typeof GENERATION_MODELS)[number];

/** Default model for T1 legal generation (F4-1: sonnet-4-6 per Henry; DOC-74 uses fable-5 as SoT) */
export const DEFAULT_GENERATION_MODEL: GenerationModel = "claude-sonnet-4-6";

/** Fallback model when primary is overloaded (DOC-74 §6.3) */
export const FALLBACK_GENERATION_MODEL: GenerationModel = "claude-sonnet-4-6";
