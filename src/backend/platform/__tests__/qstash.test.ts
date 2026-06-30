import { describe, it, expect, beforeAll } from "vitest";

/**
 * QStash's HTTP API rejects a `deduplicationId` containing `:` with a 400
 * ("DeduplicationId cannot contain ':'"). Our dedupeId convention separates
 * fields with `:` (e.g. `translate-document:<docId>:<direction>`), so every
 * per-request enqueueJob would 400 unless the id is sanitized. These tests pin
 * the sanitizer that maps a dedupeId to a QStash-safe key.
 *
 * qstash.ts transitively imports platform/env, whose core schema is parsed
 * eagerly at module load. Vitest isolates the module graph per test file, so we
 * stub the core vars and `import()` qstash AFTER — no global test env needed.
 */
let toQStashDeduplicationId: (dedupeId: string) => string;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-key";
  process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
  ({ toQStashDeduplicationId } = await import("../qstash"));
});

describe("toQStashDeduplicationId", () => {
  it("replaces the ':' separators our dedupeIds use", () => {
    expect(
      toQStashDeduplicationId("translate-document:26e1c0ab-8260-4202-8f5f-79d5a580d634:es-en"),
    ).toBe("translate-document_26e1c0ab-8260-4202-8f5f-79d5a580d634_es-en");
  });

  it("sanitizes every real dedupeId shape we publish (no ':' survives)", () => {
    const samples = [
      "run-generation:11111111-1111-1111-1111-111111111111:v3",
      "translate-document:22222222-2222-2222-2222-222222222222:en-es:retry-2",
      "extract-document:33333333-3333-3333-3333-333333333333",
      "reconcile-stripe-payments:cron",
    ];
    for (const s of samples) {
      const out = toQStashDeduplicationId(s);
      expect(out).not.toContain(":");
      expect(out).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  it("is deterministic so retries of the same logical job still collapse", () => {
    const id = "translate-document:abc:es-en";
    expect(toQStashDeduplicationId(id)).toBe(toQStashDeduplicationId(id));
  });

  it("keeps distinct dedupeIds distinct after sanitizing", () => {
    const a = toQStashDeduplicationId("translate-document:doc1:es-en");
    const b = toQStashDeduplicationId("translate-document:doc2:es-en");
    expect(a).not.toBe(b);
  });

  it("leaves already-safe characters untouched", () => {
    expect(toQStashDeduplicationId("plain-key_123")).toBe("plain-key_123");
  });
});
