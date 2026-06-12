/**
 * Whitelist of AI generation models allowed in ai_generation_configs.
 * Source: DOC-74 §1 / RF-ADM-036 (model selector).
 */
export const GENERATION_MODELS = [
  "claude-fable-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;

export type GenerationModel = (typeof GENERATION_MODELS)[number];
