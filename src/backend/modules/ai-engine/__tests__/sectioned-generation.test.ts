import { describe, it, expect } from "vitest";
import {
  buildWebSearchTool,
  countWords,
  lastWords,
  buildSectionUserMessage,
  buildExpansionUserMessage,
  assembleDocument,
  assemblePrompt,
  DEFAULT_GENERATION_RULES,
  type ConfigSnapshot,
  type ResolvedInputs,
  type GenerationSectionSpec,
} from "../domain";

const EMPTY_INPUTS: ResolvedInputs = { documents: [], forms: [] };
const NO_DATASET = { selectedItems: [], totalTokens: 0 };

function snapshot(over: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    system_prompt: "BASE PROMPT",
    input_document_slugs: [],
    input_form_slugs: [],
    dataset_id: null,
    model: "claude-sonnet-4-6",
    max_output_tokens: 32000,
    output_format: "pdf",
    output_language: "en",
    resolved_inputs: { documents: [], forms: [] },
    dataset_injection: null,
    ...over,
  };
}

function section(over: Partial<GenerationSectionSpec> = {}): GenerationSectionSpec {
  return { key: "i1", heading: "I.1 Introduction", min_words: 0, max_tokens: 4000, guidance: "", type: "analysis", ...over };
}

describe("buildWebSearchTool", () => {
  it("clamps max_uses to [1,10] and defaults to the basic variant", () => {
    expect(buildWebSearchTool(4)).toEqual({ type: "web_search_20250305", name: "web_search", max_uses: 4 });
    expect(buildWebSearchTool(0).max_uses).toBe(1);
    expect(buildWebSearchTool(99).max_uses).toBe(10);
  });
  it("uses the dynamic-filtering variant for capable models (opus 4.7 / sonnet 4.6 / fable 5)", () => {
    expect(buildWebSearchTool(5, "claude-opus-4-7").type).toBe("web_search_20260209");
    expect(buildWebSearchTool(5, "claude-sonnet-4-6").type).toBe("web_search_20260209");
    expect(buildWebSearchTool(5, "claude-fable-5").type).toBe("web_search_20260209");
  });
  it("falls back to the basic variant for models without dynamic filtering (haiku)", () => {
    expect(buildWebSearchTool(5, "claude-haiku-4-5").type).toBe("web_search_20250305");
  });
});

describe("countWords / lastWords", () => {
  it("counts words ignoring extra whitespace", () => {
    expect(countWords("  hello   world  ")).toBe(2);
    expect(countWords("")).toBe(0);
  });
  it("returns the last N words", () => {
    expect(lastWords("a b c d e", 2)).toBe("d e");
    expect(lastWords("one", 5)).toBe("one");
  });
});

describe("buildSectionUserMessage", () => {
  it("includes the heading, guidance, floor and previous-section tail", () => {
    const msg = buildSectionUserMessage(
      "CASE CONTEXT",
      section({ heading: "I.5 Narrative", min_words: 3400, guidance: "Tell the background." }),
      "...prior section tail...",
      "Use CourtListener.",
    );
    expect(msg).toContain("CASE CONTEXT");
    expect(msg).toContain("SECTION TO WRITE NOW: I.5 Narrative");
    expect(msg).toContain("Tell the background.");
    expect(msg).toContain("at least 3400 words");
    expect(msg).toContain("previous_section_tail");
    expect(msg).toContain("...prior section tail...");
    expect(msg).toContain("Use CourtListener.");
  });

  it("omits the tail block on the first section", () => {
    const msg = buildSectionUserMessage("CTX", section(), "", null);
    expect(msg).not.toContain("previous_section_tail");
  });
});

describe("buildExpansionUserMessage", () => {
  it("instructs to expand without filler and embeds the draft", () => {
    const msg = buildExpansionUserMessage("SECTION PROMPT", "short draft", 2000);
    expect(msg).toContain("SECTION PROMPT");
    expect(msg).toContain("2000+ words");
    expect(msg).toContain("short draft");
    expect(msg).toContain("do NOT pad");
  });
});

describe("assembleDocument", () => {
  const secs = [section({ heading: "I.1 Intro" }), section({ key: "i2", heading: "I.2 Jurisdiction" })];
  const parts = ["## I.1 Intro\n\nbody1", "## I.2 Jurisdiction\n\nbody2"];

  it("joins section parts", () => {
    const doc = assembleDocument(secs, parts, null);
    expect(doc).toContain("body1");
    expect(doc).toContain("body2");
  });
  it("adds a TOC and closing when configured", () => {
    const doc = assembleDocument(secs, parts, { toc: true, closing: "Respectfully submitted." });
    expect(doc).toContain("## Table of Contents");
    expect(doc).toContain("- I.1 Intro");
    expect(doc).toContain("- I.2 Jurisdiction");
    expect(doc).toContain("Respectfully submitted.");
  });
});

describe("assemblePrompt — anti-invention rules injection", () => {
  it("appends DEFAULT_GENERATION_RULES to system[0] when rules_enabled (default)", () => {
    const a = assemblePrompt(snapshot({ rules_enabled: true }), EMPTY_INPUTS, NO_DATASET);
    expect(a.system[0].text).toContain("BASE PROMPT");
    expect(a.system[0].text).toContain("R1.");
    expect(a.system[0].text).toContain(DEFAULT_GENERATION_RULES);
  });

  it("uses custom rules_text when provided", () => {
    const a = assemblePrompt(snapshot({ rules_enabled: true, rules_text: "CUSTOM RULE X" }), EMPTY_INPUTS, NO_DATASET);
    expect(a.system[0].text).toContain("CUSTOM RULE X");
    expect(a.system[0].text).not.toContain("R1.");
  });

  it("omits rules entirely when rules_enabled is false", () => {
    const a = assemblePrompt(snapshot({ rules_enabled: false }), EMPTY_INPUTS, NO_DATASET);
    expect(a.system[0].text).toBe("BASE PROMPT");
  });
});
