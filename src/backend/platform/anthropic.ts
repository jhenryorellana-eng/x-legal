/**
 * Anthropic Claude client — DOC-74 §2.1.
 *
 * Single SDK instance for the entire backend. No module imports
 * `@anthropic-ai/sdk` directly — all AI calls go through `ai-engine` (F4),
 * which is the only consumer of this client (DOC-27 §7.1, RNF-041).
 *
 * Configuration (DOC-74 §2.1):
 * - maxRetries: 3 (SDK retries 408/409/429/5xx/529 with backoff + retry-after)
 * - Timeouts vary by task type:
 *     T1 Generación legal (Fable 5): 600 s (streaming, async job)
 *     T2 Editor catálogo (Sonnet):   180 s
 *     T5 Sugerencias UI (Haiku):      30 s
 *   The timeout is set per-call in ai-engine, not here (this client uses
 *   the SDK default as a floor; per-call timeout overrides it).
 *
 * Model constants (DOC-74 §1 matrix — source of truth):
 * - T1: claude-fable-5
 * - T2: claude-sonnet-4-6 (overridable via AI_EDITOR_MODEL env)
 * - T5: claude-haiku-4-5 (overridable via AI_UI_MODEL env)
 */

import Anthropic from "@anthropic-ai/sdk";
import { providerEnv } from "./env";
import { isAiStubEnabled, stubAnthropicClient } from "./ai-stub";

// ---------------------------------------------------------------------------
// Model constants (whitelist for the catalog selector — DOC-74 §1)
// ---------------------------------------------------------------------------

/** Models allowed in the ai_generation_configs selector (DOC-74 §1). */
export const ALLOWED_GENERATION_MODELS = [
  "claude-fable-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;

export type GenerationModel = (typeof ALLOWED_GENERATION_MODELS)[number];

/** Default model for T1 legal generation (DOC-74 §1). */
export const DEFAULT_GENERATION_MODEL: GenerationModel = "claude-fable-5";

/** Default model for T2 catalog editor (DOC-74 §1). */
export const DEFAULT_EDITOR_MODEL: GenerationModel = "claude-sonnet-4-6";

/** Default model for T5 UI suggestions (DOC-74 §1). */
export const DEFAULT_UI_MODEL: GenerationModel = "claude-haiku-4-5";

// ---------------------------------------------------------------------------
// Client factory (lazy singleton)
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;

/**
 * Returns the Anthropic SDK client instance.
 * Validates the ANTHROPIC_API_KEY on first access (fails loud if not configured).
 */
export function getAnthropicClient(): Anthropic {
  // E2E / CI: deterministic fake client (DOC-81 §4.3/§4.6). Inert in prod
  // (isAiStubEnabled throws if the flag is set in a production build).
  if (isAiStubEnabled()) {
    return stubAnthropicClient as unknown as Anthropic;
  }
  if (!_client) {
    const aenv = providerEnv("anthropic");
    _client = new Anthropic({
      apiKey: aenv.ANTHROPIC_API_KEY,
      // SDK-level retries for 408/409/429/5xx/529 with exponential backoff
      // respecting the retry-after header (DOC-74 §2.4)
      maxRetries: 3,
    });
  }
  return _client;
}

/**
 * Convenience re-export. The ai-engine module uses this to get the client.
 *
 * Actual model selection, timeouts, prompt construction, and streaming logic
 * live in `backend/ai-engine/` (F4) — not here (DOC-74 §2.1).
 */
export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop: string) {
    return getAnthropicClient()[prop as keyof Anthropic];
  },
});
