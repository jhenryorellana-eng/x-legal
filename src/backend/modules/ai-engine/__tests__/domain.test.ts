/**
 * ai-engine domain — comprehensive TDD tests.
 *
 * No I/O, no mocks needed (pure functions only).
 *
 * Coverage:
 *  - canTransitionRun (state machine — every transition)
 *  - nextVersion
 *  - maskPii (SSN, A-Number, Passport)
 *  - computeAnthropicCost (all cache components, 4 decimals)
 *  - computeGeminiCost
 *  - evaluateBudget (ok / over_80 / over_100)
 *  - decideChunking (token threshold, time threshold)
 *  - selectDatasetItems (greedy, tags, outcome, recency, truncation)
 *  - assemblePrompt (system block order, cacheControl, PII masking, determinism)
 *  - validateGenerationOutput (empty, short, max_tokens, refusal, end_turn)
 *  - sumUsage (accumulation, 4 decimal rounding)
 */

import { describe, it, expect } from "vitest";
import {
  canTransitionRun,
  nextVersion,
  maskPii,
  computeAnthropicCost,
  computeGeminiCost,
  evaluateBudget,
  decideChunking,
  selectDatasetItems,
  assemblePrompt,
  validateGenerationOutput,
  sumUsage,
  curateInternalFields,
  type GenerationRunStatus,
  type DatasetItem,
  type ConfigSnapshot,
  type ResolvedInputs,
  type RunContext,
  type AnthropicUsage,
} from "../domain";

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<DatasetItem> = {}): DatasetItem {
  return {
    id: "item-1",
    title: "Test Case",
    content: "A".repeat(200),
    tags: [],
    outcome: null,
    token_count: 500,
    created_at: "2026-01-01T00:00:00.000Z",
    jurisdiction: null,
    ...overrides,
  };
}

const BASE_SNAPSHOT: ConfigSnapshot = {
  system_prompt: "You are a legal document assistant.",
  input_document_slugs: ["passport"],
  input_form_slugs: ["mi-historia"],
  dataset_id: null,
  model: "claude-sonnet-4-6",
  max_output_tokens: 32000,
  output_format: "pdf",
  output_language: "es",
  resolved_inputs: {
    documents: [
      {
        slug: "passport",
        case_document_id: "11111111-1111-4111-8111-111111111111",
        extraction_id: "22222222-2222-4222-8222-222222222222",
      },
    ],
    forms: [
      {
        slug: "mi-historia",
        response_id: "33333333-3333-4333-8333-333333333333",
      },
    ],
  },
  dataset_injection: null,
};

const BASE_INPUTS: ResolvedInputs = {
  documents: [
    {
      slug: "passport",
      extractionPayload: { name: "Maria Garcia", country: "Mexico" },
      rawText: "PASSPORT\nMARIA GARCIA\nDOB: 1985-06-15",
    },
  ],
  forms: [
    {
      slug: "mi-historia",
      answers: { reason: "Seeking asylum due to persecution", years: "5" },
    },
  ],
};

const NO_DATASET = { selectedItems: [] as DatasetItem[], totalTokens: 0 };

// ---------------------------------------------------------------------------
// 1. canTransitionRun — state machine
// ---------------------------------------------------------------------------

describe("canTransitionRun", () => {
  const validTransitions: Array<[GenerationRunStatus, GenerationRunStatus]> = [
    ["queued", "running"],
    ["queued", "cancelled"],
    ["queued", "failed"],
    ["running", "completed"],
    ["running", "failed"],
    ["running", "cancelled"],
    ["failed", "queued"],
  ];

  const invalidTransitions: Array<[GenerationRunStatus, GenerationRunStatus]> = [
    // Terminal states accept no transitions
    ["completed", "running"],
    ["completed", "failed"],
    ["completed", "cancelled"],
    ["completed", "queued"],
    ["cancelled", "queued"],
    ["cancelled", "running"],
    ["cancelled", "failed"],
    ["cancelled", "completed"],
    // Missing cross-paths
    ["queued", "completed"],
    ["failed", "running"],
    ["failed", "completed"],
    ["failed", "cancelled"],
  ];

  for (const [from, to] of validTransitions) {
    it(`allows ${from} -> ${to}`, () => {
      expect(canTransitionRun(from, to)).toBe(true);
    });
  }

  for (const [from, to] of invalidTransitions) {
    it(`rejects ${from} -> ${to}`, () => {
      expect(canTransitionRun(from, to)).toBe(false);
    });
  }

  it("failed -> queued is the only admin re-entry path", () => {
    expect(canTransitionRun("failed", "queued")).toBe(true);
    expect(canTransitionRun("completed", "queued")).toBe(false);
    expect(canTransitionRun("cancelled", "queued")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. nextVersion
// ---------------------------------------------------------------------------

describe("nextVersion", () => {
  it("returns 1 when currentMax is null", () => {
    expect(nextVersion(null)).toBe(1);
  });

  it("returns 1 when currentMax is 0", () => {
    expect(nextVersion(0)).toBe(1);
  });

  it("increments by 1", () => {
    expect(nextVersion(1)).toBe(2);
    expect(nextVersion(3)).toBe(4);
    expect(nextVersion(99)).toBe(100);
  });

  it("never fills gaps: always max+1", () => {
    // Even if versions 1-4 are deleted, next after max=5 is 6
    expect(nextVersion(5)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// 3. maskPii
// ---------------------------------------------------------------------------

describe("maskPii", () => {
  describe("SSN masking", () => {
    it("masks SSN with dashes — shows last 4", () => {
      expect(maskPii("SSN: 123-45-6789")).toBe("SSN: •••-••-6789");
    });

    it("masks SSN without dashes (compact format)", () => {
      const result = maskPii("SSN is 123456789 from form");
      expect(result).toContain("6789");
      expect(result).not.toContain("123-45");
      expect(result).not.toContain("12345");
    });

    it("masks multiple SSNs in a single string", () => {
      const result = maskPii("First: 111-22-3333, second: 444-55-6666");
      expect(result).toContain("3333");
      expect(result).toContain("6666");
      expect(result).not.toContain("111-22");
      expect(result).not.toContain("444-55");
    });

    it("preserves surrounding text", () => {
      const result = maskPii("Client SSN: 111-22-3333 on file");
      expect(result).toContain("Client SSN:");
      expect(result).toContain("on file");
    });
  });

  describe("A-Number masking", () => {
    it("masks A-Number with dash (A-123456789)", () => {
      const result = maskPii("A-Number: A123456789");
      expect(result).toContain("A-•••-•••");
      expect(result).not.toContain("123456");
    });

    it("masks A-Number without dash (A987654321)", () => {
      const result = maskPii("Alien number A987654321");
      expect(result).toContain("A-•••-•••");
      expect(result).not.toContain("987654");
    });

    it("is case-insensitive for A prefix", () => {
      const result = maskPii("number: a123456789");
      expect(result).toContain("A-•••-•••");
    });
  });

  describe("Passport number masking", () => {
    it("masks passport-like patterns (letter prefix + 5+ digits) — shows last 3", () => {
      const result = maskPii("Passport: AB1234567");
      // Last 3 chars visible: 567
      expect(result).toContain("567");
      // Full prefix should be masked
      expect(result).not.toContain("AB123");
    });

    it("masks 9-digit US passport number", () => {
      const result = maskPii("Passport no: 123456789");
      expect(result).toContain("789");
      expect(result).not.toContain("123456");
    });

    it("does not mask short codes under 4 chars", () => {
      // maskPii has a guard: match.length < 4 returns match unchanged
      expect(maskPii("code: AB1")).toContain("AB1");
    });
  });

  describe("passthrough cases", () => {
    it("returns empty string unchanged", () => {
      expect(maskPii("")).toBe("");
    });

    it("returns safe text unchanged", () => {
      const safe = "The client arrived on June 15th and filed form I-765.";
      expect(maskPii(safe)).toBe(safe);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. computeAnthropicCost
// ---------------------------------------------------------------------------

describe("computeAnthropicCost", () => {
  const baseUsage: AnthropicUsage = {
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };

  it("computes sonnet-4-6 cost (3/MTok in, 15/MTok out)", () => {
    // 1000 × 3/M + 500 × 15/M = 0.003 + 0.0075 = 0.0105
    expect(computeAnthropicCost(baseUsage, "claude-sonnet-4-6")).toBe(0.0105);
  });

  it("computes fable-5 cost (10/MTok in, 50/MTok out)", () => {
    // 1000 × 10/M + 500 × 50/M = 0.01 + 0.025 = 0.035
    expect(computeAnthropicCost(baseUsage, "claude-fable-5")).toBe(0.035);
  });

  it("computes opus-4-7 cost (5/MTok in, 25/MTok out)", () => {
    // 1000 × 5/M + 500 × 25/M = 0.005 + 0.0125 = 0.0175
    expect(computeAnthropicCost(baseUsage, "claude-opus-4-7")).toBe(0.0175);
  });

  it("computes haiku-4-5 cost (1/MTok in, 5/MTok out)", () => {
    // 1000 × 1/M + 500 × 5/M = 0.001 + 0.0025 = 0.0035
    expect(computeAnthropicCost(baseUsage, "claude-haiku-4-5")).toBe(0.0035);
  });

  it("includes cache_creation at 1.25x input price", () => {
    const usage: AnthropicUsage = {
      inputTokens: 500,
      outputTokens: 100,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 0,
    };
    // regular = 500 - 200 = 300
    // 300 × 3/M = 0.0009
    // 200 × 3/M × 1.25 = 0.00075
    // 100 × 15/M = 0.0015
    // total = 0.00315 → toFixed(4) = 0.0032
    const cost = computeAnthropicCost(usage, "claude-sonnet-4-6");
    expect(cost).toBe(0.0032);
  });

  it("includes cache_read at 0.1x input price", () => {
    const usage: AnthropicUsage = {
      inputTokens: 600,
      outputTokens: 100,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 500,
    };
    // regular = 600 - 500 = 100
    // 100 × 3/M = 0.0003
    // 500 × 3/M × 0.1 = 0.00015
    // 100 × 15/M = 0.0015
    // raw total = 0.00195 → JS toFixed(4) = "0.0019" (IEEE 754 rounding)
    const cost = computeAnthropicCost(usage, "claude-sonnet-4-6");
    expect(cost).toBe(0.0019);
  });

  it("returns null for unknown model (never blocks a run)", () => {
    expect(computeAnthropicCost(baseUsage, "gpt-4-turbo")).toBeNull();
    expect(computeAnthropicCost(baseUsage, "gemini-2.5-flash")).toBeNull();
  });

  it("returns 0 for all-zero usage", () => {
    const zero: AnthropicUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };
    expect(computeAnthropicCost(zero, "claude-sonnet-4-6")).toBe(0);
  });

  it("rounds to at most 4 decimal places", () => {
    const usage: AnthropicUsage = {
      inputTokens: 1234,
      outputTokens: 567,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };
    const cost = computeAnthropicCost(usage, "claude-sonnet-4-6");
    expect(cost).not.toBeNull();
    const decimals = (cost!.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// 5. computeGeminiCost
// ---------------------------------------------------------------------------

describe("computeGeminiCost", () => {
  it("computes cost with 0.30/MTok input and 2.50/MTok output", () => {
    // 1000 × 0.30/M + 500 × 2.50/M = 0.0003 + 0.00125 = 0.00155
    // JS toFixed(4) with IEEE 754: "0.0015" → 0.0015
    expect(computeGeminiCost({ inputTokens: 1000, outputTokens: 500 })).toBe(0.0015);
  });

  it("handles zero usage", () => {
    expect(computeGeminiCost({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("computes extraction cost for ~25K input tokens (100-page doc)", () => {
    // 25800 × 0.30/M + 1000 × 2.50/M = 0.00774 + 0.0025 = 0.01024 -> 0.0102
    expect(computeGeminiCost({ inputTokens: 25800, outputTokens: 1000 })).toBe(0.0102);
  });

  it("rounds to at most 4 decimal places", () => {
    const cost = computeGeminiCost({ inputTokens: 333, outputTokens: 777 });
    const decimals = (cost.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// 6. evaluateBudget
// ---------------------------------------------------------------------------

describe("evaluateBudget", () => {
  it("returns ok when budget is null (no budget configured)", () => {
    expect(evaluateBudget(1000, null)).toBe("ok");
  });

  it("returns ok when budget is 0 (disabled)", () => {
    expect(evaluateBudget(500, 0)).toBe("ok");
  });

  it("returns ok when budget is negative", () => {
    expect(evaluateBudget(500, -100)).toBe("ok");
  });

  it("returns ok when under 80%", () => {
    expect(evaluateBudget(0, 100)).toBe("ok");
    expect(evaluateBudget(79, 100)).toBe("ok");
    expect(evaluateBudget(79.99, 100)).toBe("ok");
  });

  it("returns over_80 at exactly 80%", () => {
    expect(evaluateBudget(80, 100)).toBe("over_80");
  });

  it("returns over_80 between 80% and 100% exclusive", () => {
    expect(evaluateBudget(85, 100)).toBe("over_80");
    expect(evaluateBudget(99, 100)).toBe("over_80");
    expect(evaluateBudget(99.99, 100)).toBe("over_80");
  });

  it("returns over_100 at exactly 100%", () => {
    expect(evaluateBudget(100, 100)).toBe("over_100");
  });

  it("returns over_100 above 100%", () => {
    expect(evaluateBudget(150, 100)).toBe("over_100");
  });

  it("works with fractional dollar amounts", () => {
    // spent=$41, budget=$50 -> 82% -> over_80
    expect(evaluateBudget(41, 50)).toBe("over_80");
    // spent=$24, budget=$50 -> 48% -> ok
    expect(evaluateBudget(24, 50)).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// 7. decideChunking
// ---------------------------------------------------------------------------

describe("decideChunking", () => {
  it("returns false for standard run within both thresholds", () => {
    // 1000 + 32000 = 33000 / 200 = 165s < 200s; 32000 not > 32000
    expect(decideChunking(32000, 1000)).toBe(false);
  });

  it("returns true when max_output_tokens > 32000", () => {
    expect(decideChunking(32001, 1000)).toBe(true);
    expect(decideChunking(64000, 1000)).toBe(true);
    expect(decideChunking(100000, 0)).toBe(true);
  });

  it("returns false when max_output_tokens is exactly 32000", () => {
    // Boundary: 32000 is NOT > 32000
    expect(decideChunking(32000, 0)).toBe(false);
  });

  it("returns true when projected duration > 200s (time threshold)", () => {
    // 8001 + 32000 = 40001 / 200 = 200.005s > 200
    expect(decideChunking(32000, 8001)).toBe(true);
  });

  it("returns false when projected duration is exactly 200s", () => {
    // 8000 + 32000 = 40000 / 200 = 200s NOT > 200
    expect(decideChunking(32000, 8000)).toBe(false);
  });

  it("returns true with large input crossing time threshold", () => {
    // 10000 + 32000 = 42000 / 200 = 210s > 200
    expect(decideChunking(32000, 10000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. selectDatasetItems
// ---------------------------------------------------------------------------

describe("selectDatasetItems", () => {
  const context: RunContext = { serviceSlug: "asilo", phaseSlug: "inicial" };

  it("returns empty when no items provided", () => {
    const result = selectDatasetItems([], context);
    expect(result.selectedItems).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
  });

  it("includes all items within budget", () => {
    const items = [
      makeItem({ id: "a", token_count: 1000 }),
      makeItem({ id: "b", token_count: 1000 }),
    ];
    const result = selectDatasetItems(items, context, 5000);
    expect(result.selectedItems).toHaveLength(2);
    expect(result.totalTokens).toBe(2000);
  });

  it("skips items that do not fit after first item is placed", () => {
    // Budget 10000 x 0.9 = 9000 effective; a=8000 fits, b=2000 does not
    const items = [
      makeItem({ id: "a", token_count: 8000 }),
      makeItem({ id: "b", token_count: 2000 }),
    ];
    const result = selectDatasetItems(items, context, 10000);
    expect(result.selectedItems).toHaveLength(1);
    expect(result.selectedItems[0].id).toBe("a");
    expect(result.totalTokens).toBe(8000);
  });

  it("truncates the first item if it alone exceeds budget", () => {
    const items = [
      makeItem({ id: "big", token_count: 50000, content: "X".repeat(50000) }),
    ];
    // Budget 10000 x 0.9 = 9000
    const result = selectDatasetItems(items, context, 10000);
    expect(result.selectedItems).toHaveLength(1);
    expect(result.selectedItems[0].id).toBe("big");
    expect(result.totalTokens).toBe(9000);
    expect(result.selectedItems[0].token_count).toBe(9000);
  });

  it("prioritizes items with more matching context tags (intersection score)", () => {
    const items = [
      makeItem({ id: "no-tags", token_count: 500, tags: [] }),
      makeItem({ id: "one-tag", token_count: 500, tags: ["asilo"] }),
      makeItem({ id: "two-tags", token_count: 500, tags: ["asilo", "inicial"] }),
    ];
    const result = selectDatasetItems(items, context, 50000);
    expect(result.selectedItems[0].id).toBe("two-tags");
    expect(result.selectedItems[1].id).toBe("one-tag");
    expect(result.selectedItems[2].id).toBe("no-tags");
  });

  it("prioritizes outcome=granted within same tag score", () => {
    const items = [
      makeItem({ id: "denied", token_count: 500, tags: ["asilo"], outcome: "denied" }),
      makeItem({ id: "none", token_count: 500, tags: ["asilo"], outcome: null }),
      makeItem({ id: "granted", token_count: 500, tags: ["asilo"], outcome: "granted" }),
    ];
    const result = selectDatasetItems(items, context, 50000);
    expect(result.selectedItems[0].id).toBe("granted");
  });

  it("sorts by created_at DESC within same tag+outcome score", () => {
    const items = [
      makeItem({
        id: "older",
        token_count: 500,
        tags: [],
        outcome: "granted",
        created_at: "2024-01-01T00:00:00.000Z",
      }),
      makeItem({
        id: "newer",
        token_count: 500,
        tags: [],
        outcome: "granted",
        created_at: "2026-01-01T00:00:00.000Z",
      }),
    ];
    const result = selectDatasetItems(items, context, 50000);
    expect(result.selectedItems[0].id).toBe("newer");
  });

  it("applies 90% safety margin on budget", () => {
    // Budget 10000 -> effective 9000; a=8000 + b=500 = 8500 fits within 9000
    const items = [
      makeItem({ id: "a", token_count: 8000 }),
      makeItem({ id: "b", token_count: 500 }),
    ];
    const result = selectDatasetItems(items, context, 10000);
    expect(result.selectedItems).toHaveLength(2);
    expect(result.totalTokens).toBe(8500);
  });

  it("uses default budget (50K) when none provided", () => {
    // 45K item should fit in 50K * 0.9 = 45K effective
    const bigItem = makeItem({ id: "x", token_count: 45000, content: "Z".repeat(45000) });
    const result = selectDatasetItems([bigItem], context);
    expect(result.selectedItems).toHaveLength(1);
  });

  it("accumulates totalTokens correctly across multiple items", () => {
    const items = [
      makeItem({ id: "a", token_count: 1000 }),
      makeItem({ id: "b", token_count: 2000 }),
      makeItem({ id: "c", token_count: 3000 }),
    ];
    const result = selectDatasetItems(items, context, 100000);
    expect(result.totalTokens).toBe(6000);
  });
});

// ---------------------------------------------------------------------------
// 9. assemblePrompt
// ---------------------------------------------------------------------------

describe("assemblePrompt", () => {
  it("places system_prompt text in system[0]", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    // system[0] = system_prompt (+ default anti-invention rules, both stable).
    expect(result.system[0].text).toContain(BASE_SNAPSHOT.system_prompt);
  });

  it("sets cacheControl=ephemeral on system[0] when no dataset (only stable block)", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    expect(result.system[0].cacheControl).toBe("ephemeral");
  });

  it("has exactly 1 system block when no dataset", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    expect(result.system).toHaveLength(1);
  });

  it("places dataset XML in system[1] when dataset is provided", () => {
    const dataset = {
      selectedItems: [makeItem({ id: "ds-1", title: "Caso de Asilo 2025" })],
      totalTokens: 500,
    };
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, dataset);
    expect(result.system).toHaveLength(2);
    expect(result.system[1].text).toContain("<dataset");
    expect(result.system[1].text).toContain("Caso de Asilo 2025");
  });

  it("sets cacheControl on system[1] only (last stable block) when dataset exists", () => {
    const dataset = {
      selectedItems: [makeItem({ id: "ds-1" })],
      totalTokens: 500,
    };
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, dataset);
    // system[0] must NOT carry cacheControl when dataset is present
    expect(result.system[0].cacheControl).toBeUndefined();
    // system[1] is the last stable block
    expect(result.system[1].cacheControl).toBe("ephemeral");
  });

  it("returns datasetInjection with item IDs and totalTokens", () => {
    const dataset = {
      selectedItems: [makeItem({ id: "ds-1" }), makeItem({ id: "ds-2" })],
      totalTokens: 1000,
    };
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, dataset);
    expect(result.datasetInjection).not.toBeNull();
    expect(result.datasetInjection!.itemIds).toEqual(["ds-1", "ds-2"]);
    expect(result.datasetInjection!.totalTokens).toBe(1000);
  });

  it("returns null datasetInjection when no dataset", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    expect(result.datasetInjection).toBeNull();
  });

  it("produces exactly 1 user message", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  it("includes document slug in user message", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    expect(result.messages[0].content).toContain("passport");
  });

  it("includes extraction payload values in user message", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    expect(result.messages[0].content).toContain("Maria Garcia");
  });

  it("masks PII in extraction payload values, including nested arrays (recursive)", () => {
    const inputs: ResolvedInputs = {
      ...BASE_INPUTS,
      documents: [
        {
          slug: "passport",
          // top-level string SSN + an SSN nested inside an array value
          extractionPayload: { ssn: "123-45-6789", aliases: ["John 987-65-4321 Doe"] },
          rawText: "no pii here",
        },
      ],
    };
    const content = assemblePrompt(BASE_SNAPSHOT, inputs, NO_DATASET).messages[0].content;
    // Neither the top-level nor the array-nested SSN may reach the AI provider.
    expect(content).not.toContain("123-45-6789");
    expect(content).not.toContain("987-65-4321");
    expect(content).toContain("•••-••-6789");
    expect(content).toContain("•••-••-4321");
  });

  it("includes raw_text of documents in user message", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    expect(result.messages[0].content).toContain("PASSPORT");
  });

  it("includes form slug in user message", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    expect(result.messages[0].content).toContain("mi-historia");
  });

  it("includes format/language instructions in user message", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    expect(result.messages[0].content).toContain("INSTRUCCIONES DE FORMATO");
  });

  it("NOTHING variable in system[] — system[0] contains only the system_prompt", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    expect(result.system[0].text).toContain(BASE_SNAPSHOT.system_prompt);
    // No case-specific data in system blocks
    expect(result.system[0].text).not.toContain("Maria Garcia");
    expect(result.system[0].text).not.toContain("PASSPORT");
    expect(result.system[0].text).not.toContain("mi-historia");
  });

  it("masks SSN in extraction payload before including in messages", () => {
    const inputsWithSsn: ResolvedInputs = {
      documents: [
        {
          slug: "i-765",
          extractionPayload: { ssn: "123-45-6789", name: "Juan Lopez" },
          rawText: "FORM I-765\nSSN: 123-45-6789",
        },
      ],
      forms: [],
    };
    const result = assemblePrompt(BASE_SNAPSHOT, inputsWithSsn, NO_DATASET);
    const content = result.messages[0].content;
    expect(content).not.toContain("123-45-6789");
    // Masked version shows last 4
    expect(content).toContain("6789");
  });

  it("masks A-Number in form answers before including in messages", () => {
    const inputsWithAnumber: ResolvedInputs = {
      documents: [],
      forms: [
        {
          slug: "formulario",
          answers: { alien_number: "A123456789", name: "Rosa Torres" },
        },
      ],
    };
    const result = assemblePrompt(BASE_SNAPSHOT, inputsWithAnumber, NO_DATASET);
    const content = result.messages[0].content;
    expect(content).not.toContain("A123456789");
    expect(content).toContain("A-•••-•••");
  });

  it("is deterministic — identical inputs always produce identical output", () => {
    const r1 = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    const r2 = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    expect(r1.system[0].text).toBe(r2.system[0].text);
    expect(r1.messages[0].content).toBe(r2.messages[0].content);
    expect(r1.datasetInjection).toBeNull();
    expect(r2.datasetInjection).toBeNull();
  });

  it("deterministic with dataset provided", () => {
    const dataset = {
      selectedItems: [makeItem({ id: "ds-x", title: "Stability Test" })],
      totalTokens: 200,
    };
    const r1 = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, dataset);
    const r2 = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, dataset);
    expect(r1.system[1].text).toBe(r2.system[1].text);
    expect(r1.messages[0].content).toBe(r2.messages[0].content);
  });

  it("uses Spanish instruction for output_language=es", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET);
    expect(result.messages[0].content).toContain("ESPAÑOL");
  });

  it("uses English instruction when outputLanguage override=en", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET, "en");
    expect(result.messages[0].content).toContain("ENGLISH");
  });

  it("includes bilingual instructions for outputLanguage=both", () => {
    const result = assemblePrompt(BASE_SNAPSHOT, BASE_INPUTS, NO_DATASET, "both");
    expect(result.messages[0].content).toContain("español");
  });
});

// ---------------------------------------------------------------------------
// 10. validateGenerationOutput
// ---------------------------------------------------------------------------

describe("validateGenerationOutput", () => {
  const LONG_TEXT = "A".repeat(1000);

  it("returns ok for valid long output with end_turn", () => {
    const result = validateGenerationOutput(LONG_TEXT, "end_turn");
    expect(result.ok).toBe(true);
  });

  it("returns EMPTY for empty string", () => {
    const result = validateGenerationOutput("", "end_turn");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; code: string }).code).toBe("EMPTY");
  });

  it("returns EMPTY for whitespace-only string", () => {
    const result = validateGenerationOutput("   \n\t  ", "end_turn");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; code: string }).code).toBe("EMPTY");
  });

  it("EMPTY check fires before refusal check", () => {
    // Empty string with refusal stop_reason -> EMPTY wins
    const result = validateGenerationOutput("", "refusal");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; code: string }).code).toBe("EMPTY");
  });

  it("returns REFUSAL for refusal stop_reason (long text)", () => {
    const result = validateGenerationOutput(LONG_TEXT, "refusal");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; code: string }).code).toBe("REFUSAL");
  });

  it("returns TRUNCATED for max_tokens stop_reason", () => {
    const result = validateGenerationOutput(LONG_TEXT, "max_tokens");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; code: string }).code).toBe("TRUNCATED");
  });

  it("returns TOO_SHORT when length < default minLength (800)", () => {
    const result = validateGenerationOutput("Short text", "end_turn");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; code: string }).code).toBe("TOO_SHORT");
  });

  it("returns ok for exactly minLength (800) characters", () => {
    const exactly800 = "A".repeat(800);
    expect(validateGenerationOutput(exactly800, "end_turn").ok).toBe(true);
  });

  it("returns TOO_SHORT for minLength - 1 (799) characters", () => {
    const tooShort = "A".repeat(799);
    const result = validateGenerationOutput(tooShort, "end_turn");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; code: string }).code).toBe("TOO_SHORT");
  });

  it("respects custom minLength parameter", () => {
    const result = validateGenerationOutput("Hello World!", "end_turn", 5);
    expect(result.ok).toBe(true);
  });

  it("trims whitespace when checking length", () => {
    // Padded version of exactly 800 chars core should still be ok
    const padded = "  " + "A".repeat(800) + "  ";
    expect(validateGenerationOutput(padded, "end_turn").ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. sumUsage
// ---------------------------------------------------------------------------

describe("sumUsage", () => {
  const usage1: AnthropicUsage & { costUsd: number } = {
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationInputTokens: 100,
    cacheReadInputTokens: 200,
    costUsd: 0.0105,
  };

  const usage2: AnthropicUsage & { costUsd: number } = {
    inputTokens: 2000,
    outputTokens: 800,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 400,
    costUsd: 0.018,
  };

  it("initializes from null accumulator with first usage values", () => {
    const result = sumUsage(null, usage1);
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
    expect(result.cacheCreationInputTokens).toBe(100);
    expect(result.cacheReadInputTokens).toBe(200);
    expect(result.costUsd).toBe(0.0105);
  });

  it("accumulates token counts across two calls", () => {
    const accum = sumUsage(null, usage1);
    const result = sumUsage(accum, usage2);
    expect(result.inputTokens).toBe(3000);
    expect(result.outputTokens).toBe(1300);
    expect(result.cacheCreationInputTokens).toBe(100);
    expect(result.cacheReadInputTokens).toBe(600);
  });

  it("accumulates cost correctly", () => {
    const accum = sumUsage(null, usage1);
    const result = sumUsage(accum, usage2);
    // 0.0105 + 0.0180 = 0.0285
    expect(result.costUsd).toBe(0.0285);
  });

  it("handles zero usage accumulation", () => {
    const zero: AnthropicUsage & { costUsd: number } = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      costUsd: 0,
    };
    const result = sumUsage(null, zero);
    expect(result.inputTokens).toBe(0);
    expect(result.costUsd).toBe(0);
  });

  it("rounds costUsd to at most 4 decimal places", () => {
    const tiny: AnthropicUsage & { costUsd: number } = {
      inputTokens: 1,
      outputTokens: 1,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      costUsd: 0.00001,
    };
    const accum = sumUsage(null, tiny);
    const result = sumUsage(accum, tiny);
    const decimals = (result.costUsd.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(4);
  });

  it("handles undefined accumulator same as null", () => {
    const result = sumUsage(undefined, usage1);
    expect(result.inputTokens).toBe(1000);
    expect(result.costUsd).toBe(0.0105);
  });

  it("triple accumulation works correctly (multi-chunk run)", () => {
    const chunk1 = sumUsage(null, usage1);
    const chunk2 = sumUsage(chunk1, usage2);
    const chunk3 = sumUsage(chunk2, {
      inputTokens: 500,
      outputTokens: 200,
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 100,
      costUsd: 0.005,
    });
    expect(chunk3.inputTokens).toBe(3500);
    expect(chunk3.outputTokens).toBe(1500);
    expect(chunk3.cacheCreationInputTokens).toBe(150);
    expect(chunk3.cacheReadInputTokens).toBe(700);
    // 0.0105 + 0.018 + 0.005 = 0.0335
    expect(chunk3.costUsd).toBe(0.0335);
  });
});

// ---------------------------------------------------------------------------
// Form-segmentation propose helpers (Ola 2 — robust full-coverage propose)
// ---------------------------------------------------------------------------

describe("curateInternalFields", () => {
  it("drops signature/preparer/interpreter/attorney/barcode/page-number/office-use fields", () => {
    const fields = [
      { name: "Pt1Line1_FamilyName", page: 1 },
      { name: "Pt1_Signature", page: 12 },
      { name: "Preparer_Name", page: 12 },
      { name: "Interpreter_Signature", page: 12 },
      { name: "Attorney_StateBar", page: 12 },
      { name: "barcode_1", page: 1 },
      { name: "PageNumber", page: 1 },
      { name: "ForUSCISUseOnly", page: 1 },
      { name: "Pt2Line3_City", page: 2 },
    ];
    const { kept, dropped } = curateInternalFields(fields);
    expect(dropped).toBe(7);
    expect(kept.map((f) => f.name)).toEqual(["Pt1Line1_FamilyName", "Pt2Line3_City"]);
  });

  it("does not drop real fields that merely contain look-alike substrings", () => {
    const fields = [
      { name: "DesignatedRepresentative", page: 1 }, // contains 'sign' but not 'signature'
      { name: "AssignmentCountry", page: 1 },
    ];
    expect(curateInternalFields(fields).dropped).toBe(0);
  });

  it("keeps the vast majority of a real form's fields (I-589 ~ 460)", () => {
    // mostly real client fields + a handful of internal ones
    const fields = [
      ...Array.from({ length: 50 }, (_, i) => ({ name: `Pt1Line${i}_Data`, page: 1 })),
      { name: "Pt1_Signature", page: 1 },
      { name: "Preparer_Name", page: 2 },
      { name: "PDF417BarCode1", page: 1 },
    ];
    const { kept, dropped } = curateInternalFields(fields);
    expect(dropped).toBe(3);
    expect(kept).toHaveLength(50);
  });
});
