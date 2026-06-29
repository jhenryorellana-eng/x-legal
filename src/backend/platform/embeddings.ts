/**
 * Gemini text embeddings (Etapa D — semantic retrieval for the legal dataset).
 *
 * Single entry point `embedText` used to (a) embed `ai_dataset_items` at backfill
 * time and (b) embed a case's profile/query at retrieval time. Cosine similarity
 * in pgvector (`vector_cosine_ops`) is scale-invariant, so no L2 normalization is
 * needed for the reduced 768-dim output.
 *
 * Model verified live (2026-06-29, docs/_evidence/embed-probe.ts):
 *   gemini-embedding-001 → 3072 dims by default; outputDimensionality:768 → 768.
 *   (text-embedding-004 is no longer served → 404.)
 *
 * Boundary: platform layer, reuses getGeminiClient (platform→platform). Consumed
 * by ai-engine, which owns the retrieval + Pre-Mortem orchestration.
 */

import { getGeminiClient } from "./gemini";
import { isAiStubEnabled } from "./ai-stub";

export const EMBEDDING_MODEL = "gemini-embedding-001";
/** Stored as vector(768) — matches the 0055 migration column + hnsw index. */
export const EMBEDDING_DIM = 768;

/**
 * Deterministic fake embedding for E2E/CI (AI_E2E_STUB) — same text → same vector,
 * so retrieval is reproducible without spending Gemini quota. NOT for prod.
 */
function stubEmbedding(text: string): number[] {
  // xorshift seeded by a cheap string hash → deterministic pseudo-random floats.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const out = new Array<number>(EMBEDDING_DIM);
  let s = h || 1;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    out[i] = (s / 0xffffffff) * 2 - 1; // [-1, 1]
  }
  return out;
}

/**
 * Embed a single text into a 768-dim vector via Gemini. Retries transient
 * 429/5xx a couple of times (the SDK does not retry automatically).
 *
 * @throws if the API fails after retries or returns an unexpected shape.
 */
export async function embedText(text: string): Promise<number[]> {
  if (isAiStubEnabled()) return stubEmbedding(text);

  const input = text.trim();
  if (!input) throw new Error("embedText: empty input");

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await getGeminiClient().models.embedContent({
        model: EMBEDDING_MODEL,
        contents: input,
        config: { outputDimensionality: EMBEDDING_DIM },
      });
      const vec = res.embeddings?.[0]?.values;
      if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
        throw new Error(`embedText: unexpected embedding shape (len=${vec?.length ?? "?"})`);
      }
      return vec;
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number; code?: number })?.status ?? (err as { code?: number })?.code;
      const retryable = status === 429 || status === 503 || (typeof status === "number" && status >= 500);
      if (!retryable || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("embedText: failed");
}

/** Serialize a vector for a pgvector literal / RPC arg: "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
