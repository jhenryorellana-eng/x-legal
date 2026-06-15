/**
 * AI stub tests (DOC-81 §4.3/§4.6 test seam).
 *
 * Verifies the deterministic AI stub is (1) safely gated — never active in
 * production — and (2) faithful to the SDK response shapes that
 * ai-engine/service.ts actually reads, so specs/integration relying on it match
 * the real pipeline.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// anthropic.ts / gemini.ts import ./env, which validates the full env eagerly at
// module load — undefined in the vitest process. Stub it so the client factories
// can be imported; the production-guard tests below throw BEFORE any env access.
vi.mock("../env", () => ({
  env: {},
  providerEnv: () => ({}),
}));

import {
  isAiStubEnabled,
  stubAnthropicClient,
  stubGeminiModels,
} from "../ai-stub";
import { getAnthropicClient } from "../anthropic";
import { getGeminiModels } from "../gemini";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAiStubEnabled — gating", () => {
  it("is false without the flag", () => {
    vi.stubEnv("AI_E2E_STUB", "");
    expect(isAiStubEnabled()).toBe(false);
  });

  it("is true with AI_E2E_STUB=1 in non-production", () => {
    vi.stubEnv("AI_E2E_STUB", "1");
    vi.stubEnv("NODE_ENV", "test");
    expect(isAiStubEnabled()).toBe(true);
  });

  it("THROWS if the flag is set in production (fail loud — never fake AI for real clients)", () => {
    vi.stubEnv("AI_E2E_STUB", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => isAiStubEnabled()).toThrow(/production/i);
  });

  it("ignores any value other than '1'", () => {
    vi.stubEnv("AI_E2E_STUB", "true");
    expect(isAiStubEnabled()).toBe(false);
  });
});

describe("production guard propagates through the client factories", () => {
  // The guard only matters if the CALLERS hit it. These exercise the exact call
  // sites used by ai-engine, so a refactor that caches the flag can't bypass it.
  it("getAnthropicClient throws when AI_E2E_STUB=1 in production", () => {
    vi.stubEnv("AI_E2E_STUB", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getAnthropicClient()).toThrow(/production/i);
  });

  it("getGeminiModels throws when AI_E2E_STUB=1 in production", () => {
    vi.stubEnv("AI_E2E_STUB", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getGeminiModels()).toThrow(/production/i);
  });
});

describe("stubAnthropicClient — T1 generation shape (messages.stream → finalMessage)", () => {
  it("returns a finalMessage with text content + usage tokens (the fields service.ts reads)", async () => {
    const stream = stubAnthropicClient.messages.stream({ model: "claude-fable-5" });
    const msg = await stream.finalMessage();

    expect(msg.stop_reason).toBe("end_turn");
    expect(msg.model).toBe("claude-fable-5");
    // service.ts: message.content.filter(type==='text').map(b=>b.text).join("")
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    expect(text.length).toBeGreaterThan(200); // passes MIN_OUTPUT_CHARS
    // service.ts: usage.input_tokens / output_tokens → cost > 0
    expect(msg.usage.input_tokens).toBeGreaterThan(0);
    expect(msg.usage.output_tokens).toBeGreaterThan(0);
  });
});

describe("stubAnthropicClient — T2 editor shapes (messages.create)", () => {
  it("research call (web_search tool) returns a plain-text brief", async () => {
    const res = await stubAnthropicClient.messages.create({
      model: "claude-sonnet-4-6",
      system: "research assistant",
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: "Research the I-765" }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    expect(text).toContain("stub");
    expect(() => JSON.parse(text)).toThrow(); // brief is NOT json
  });

  it("segmentation call returns parseable {groups:[...]} json mapping the first detected field", async () => {
    const res = await stubAnthropicClient.messages.create({
      model: "claude-sonnet-4-6",
      system: "You are a senior U.S. immigration paralegal ... ONLY the JSON object",
      messages: [
        { role: "user", content: "Detected AcroForm fields (2):\n- Pt1Line5_Email (text, page 1)\n- Foo (text, page 2)" },
      ],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(text) as {
      groups: Array<{ title_i18n: { es: string; en: string }; questions: Array<{ pdf_field_name: string | null }> }>;
    };
    expect(Array.isArray(parsed.groups)).toBe(true);
    expect(parsed.groups.length).toBeGreaterThan(0);
    expect(parsed.groups[0].title_i18n.es).toBeTruthy();
    // The first question maps to the first detected field name extracted from the prompt.
    expect(parsed.groups[0].questions[0].pdf_field_name).toBe("Pt1Line5_Email");
  });

  it("extraction-schema call returns parseable {schema:{...}} json", async () => {
    const res = await stubAnthropicClient.messages.create({
      model: "claude-sonnet-4-6",
      system: "You are a JSON Schema expert for document extraction.",
      messages: [{ role: "user", content: "Create a JSON Schema for a passport" }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(text) as { schema: { type: string; required: string[] } };
    expect(parsed.schema.type).toBe("object");
    expect(Array.isArray(parsed.schema.required)).toBe(true);
  });
});

describe("stubGeminiModels — T3/T4 shape (generateContent)", () => {
  it("extraction: fills every required schema key + raw_text (the validator's requirement)", async () => {
    const res = await stubGeminiModels.generateContent({
      model: "gemini-2.5-flash",
      contents: [],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: { full_name: { type: "string" }, age: { type: "number" } },
          required: ["full_name", "age", "raw_text"],
        },
      },
    });
    // service.ts reads response.candidates[0].content.parts[0].text + usageMetadata.*
    const text = res.candidates[0].content.parts[0].text;
    const obj = JSON.parse(text) as Record<string, unknown>;
    expect(obj.raw_text).toBeTruthy();
    expect(obj.full_name).toBeDefined();
    expect(obj.age).toBeDefined();
    expect(res.usageMetadata.promptTokenCount).toBeGreaterThan(0);
    expect(res.usageMetadata.candidatesTokenCount).toBeGreaterThan(0);
  });

  it("translation (no schema): returns plain text", async () => {
    const res = await stubGeminiModels.generateContent({
      model: "gemini-2.5-flash",
      contents: [],
      config: { temperature: 0 },
    });
    expect(res.candidates[0].content.parts[0].text).toContain("stub");
    expect(res.text).toContain("stub");
  });
});
