/**
 * enforceSectionLength — target-length control per drafted section (ola apelación).
 *
 * (1) stopReason 'max_tokens' → one concision retry; a second truncation throws
 *     SectionTruncatedError (the run fails LOUDLY — end of silent truncation).
 * (2) Below the floor → expansion bounded by the ceiling.
 * (3) Above ceiling×1.15 → one condense pass that must shrink without losing
 *     the floor.
 */

import { describe, it, expect, vi } from "vitest";

// Import-graph platform mocks (service.ts pulls providers at module load).
vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn(),
  AuthzError: class AuthzError extends Error {},
}));
vi.mock("@/backend/platform/qstash", () => ({ enqueueJob: vi.fn() }));
vi.mock("@/backend/platform/anthropic", () => ({
  getAnthropicClient: vi.fn(),
  DEFAULT_UI_MODEL: "claude-haiku-4-5",
}));
vi.mock("@/backend/platform/ratelimit", () => ({ limitAiImprove: vi.fn() }));
vi.mock("@/backend/platform/gemini", () => ({
  getGeminiModels: vi.fn(),
  DEFAULT_GEMINI_MODEL: "gemini-2.5-flash",
}));
vi.mock("@/backend/platform/ai-stub", () => ({ isAiStubEnabled: () => false }));
vi.mock("@/backend/platform/storage", () => ({
  createSignedDownloadUrl: vi.fn(),
  uploadBytesToStorage: vi.fn(),
  downloadBytesFromStorage: vi.fn(),
}));
vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/backend/modules/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/backend/modules/catalog", () => ({ getServiceTranslationConfig: vi.fn() }));
vi.mock("@/backend/platform/url-utils", () => ({
  checkUrlReachable: vi.fn(),
  keepReachable: vi.fn(),
  isLikelyUrl: () => true,
}));
vi.mock("../repository", () => ({}));
vi.mock("../events", () => ({
  emitGenerationCompleted: vi.fn(),
  emitGenerationFailed: vi.fn(),
  emitExtractionCompleted: vi.fn(),
}));

import { enforceSectionLength, SectionTruncatedError } from "../service";
import type { GenerationSectionSpec } from "../domain";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

function section(over: Partial<GenerationSectionSpec> = {}): GenerationSectionSpec {
  return { key: "a6", heading: "A.6 Argument", min_words: 0, max_tokens: 4000, guidance: "", type: "analysis", ...over };
}

describe("enforceSectionLength", () => {
  it("returns the first draft untouched when it is within range (zero extra calls)", async () => {
    const call = vi.fn();
    const text = words(1000);
    const out = await enforceSectionLength({
      section: section({ min_words: 900, max_words: 1300 }),
      sectionUserContent: "SEC",
      first: { text, stopReason: "end_turn" },
      call,
    });
    expect(out).toBe(text);
    expect(call).not.toHaveBeenCalled();
  });

  it("retries ONCE on max_tokens and accepts a complete rewrite", async () => {
    const call = vi.fn().mockResolvedValue({ text: words(1000), stopReason: "end_turn" });
    const out = await enforceSectionLength({
      section: section({ min_words: 900, max_words: 1300 }),
      sectionUserContent: "SEC",
      first: { text: words(500), stopReason: "max_tokens" },
      call,
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(String(call.mock.calls[0][0])).toContain("cut off by the token limit");
    expect(out.split(" ")).toHaveLength(1000);
  });

  it("throws SectionTruncatedError when the retry truncates again", async () => {
    const call = vi.fn().mockResolvedValue({ text: words(500), stopReason: "max_tokens" });
    await expect(
      enforceSectionLength({
        section: section({ key: "a12" }),
        sectionUserContent: "SEC",
        first: { text: words(500), stopReason: "max_tokens" },
        call,
      }),
    ).rejects.toThrow(SectionTruncatedError);
  });

  it("condenses a draft over ceiling×1.15 and keeps the shrunk version", async () => {
    const call = vi.fn().mockResolvedValue({ text: words(1200), stopReason: "end_turn" });
    const out = await enforceSectionLength({
      section: section({ min_words: 900, max_words: 1300 }),
      sectionUserContent: "SEC",
      first: { text: words(2000), stopReason: "end_turn" },
      call,
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(String(call.mock.calls[0][0])).toContain("exceeded the hard ceiling of 1300");
    expect(out.split(" ")).toHaveLength(1200);
  });

  it("keeps the original when the condense pass would fall below the floor", async () => {
    const call = vi.fn().mockResolvedValue({ text: words(100), stopReason: "end_turn" });
    const original = words(2000);
    const out = await enforceSectionLength({
      section: section({ min_words: 900, max_words: 1300 }),
      sectionUserContent: "SEC",
      first: { text: original, stopReason: "end_turn" },
      call,
    });
    expect(out).toBe(original);
  });

  it("expands under the floor but rejects an expansion that blows past the ceiling", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ text: words(5000), stopReason: "end_turn" }) // expansion way over ceiling → rejected
      .mockResolvedValueOnce({ text: words(1100), stopReason: "end_turn" }); // condense of the original? (not reached)
    const original = words(300);
    const out = await enforceSectionLength({
      section: section({ min_words: 900, max_words: 1300 }),
      sectionUserContent: "SEC",
      first: { text: original, stopReason: "end_turn" },
      call,
    });
    // expansion rejected (over ceiling), original kept, no condense (300 < ceiling)
    expect(out).toBe(original);
    expect(call).toHaveBeenCalledTimes(1);
    expect(String(call.mock.calls[0][0])).toContain("NEVER past 1300 words");
  });

  it("legacy sections (no max_words) keep the floor-only expansion behavior", async () => {
    const call = vi.fn().mockResolvedValue({ text: words(4000), stopReason: "end_turn" });
    const out = await enforceSectionLength({
      section: section({ min_words: 2400 }),
      sectionUserContent: "SEC",
      first: { text: words(1000), stopReason: "end_turn" },
      call,
    });
    expect(out.split(" ")).toHaveLength(4000); // expansion accepted, no ceiling fight
    expect(call).toHaveBeenCalledTimes(1);
  });
});
