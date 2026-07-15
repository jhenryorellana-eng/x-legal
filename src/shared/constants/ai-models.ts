/**
 * Whitelist of AI generation models allowed in ai_generation_configs.
 * Source: DOC-74 §1 / RF-ADM-036 (model selector).
 *
 *   - claude-opus-4-7  — premium (asylum-memo research). Verified valid at runtime 2026-07-15.
 *   - claude-sonnet-4-6 — default for legal generation (asylum-memo drafting).
 *   - claude-fable-5   — kept; remains T1 default per DOC-74 §1.
 *   - claude-haiku-4-5 — lightweight tasks (T5, summaries).
 *
 * ⚠ Adding a model here is NOT enough on its own: the `ai_generation_configs.model` CHECK
 * constraint (migration 0017) and MODEL_PRICING (ai-engine/domain.ts) must be widened in the
 * SAME change, or the catalog editor will offer a model that the DB rejects on save / whose
 * cost is dropped as null. (Kept to the 4 ids the DB CHECK already allows.)
 */
export const GENERATION_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "claude-fable-5",
  "claude-haiku-4-5",
] as const;

export type GenerationModel = (typeof GENERATION_MODELS)[number];

/** Default model for T1 legal generation (F4-1: sonnet-4-6 per Henry; DOC-74 uses fable-5 as SoT) */
export const DEFAULT_GENERATION_MODEL: GenerationModel = "claude-sonnet-4-6";

/** Fallback model when primary is overloaded (DOC-74 §6.3) */
export const FALLBACK_GENERATION_MODEL: GenerationModel = "claude-sonnet-4-6";
