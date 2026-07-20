import { describe, it, expect } from "vitest";

import { detectPosture, type PostureRule } from "@/backend/modules/catalog/domain";

/**
 * Wave 2 / D3 — procedural posture.
 *
 * Case U26-000038 was decided by PRETERMISSION: the judge granted DHS's motion and
 * never reached the merits, so no credibility finding, PSG analysis or relocation
 * analysis exists anywhere. The generator nevertheless produced merits-appeal
 * questions ("what did the judge say about your credibility?"), which are
 * unanswerable by construction — no retrieval improvement can fix them.
 *
 * Detection runs on STRUCTURED extraction fields, never regex over raw_text: the
 * latter is how a declarative rule set rots into an unmaintainable rules engine.
 * A posture may only add required sources, inject a prompt fragment and set flags.
 */

const PRETERMISSION: PostureRule = {
  slug: "pretermision",
  conditions: [
    { field: "dispositive_motion_granted", op: "equals", value: "pretermit" },
    { field: "reached_merits", op: "is_false" },
  ],
  requiredSourceSlugs: ["mocion-pretermision-dhs", "transcript-audiencia"],
  questionPlaybookPrompt: "El juez NO llegó al fondo.",
};

const MERITS_DENIAL: PostureRule = {
  slug: "denegacion-de-fondo",
  conditions: [{ field: "reached_merits", op: "is_true" }],
  requiredSourceSlugs: [],
  questionPlaybookPrompt: "El juez resolvió el fondo.",
};

const IN_ABSENTIA: PostureRule = {
  slug: "in-absentia",
  conditions: [{ field: "decision_outcome", op: "in", value: ["in_absentia_order"] }],
  requiredSourceSlugs: ["nta"],
  questionPlaybookPrompt: null,
};

const RULES = [MERITS_DENIAL, PRETERMISSION, IN_ABSENTIA];

describe("detectPosture", () => {
  it("detects the real case: pretermission, not a merits denial", () => {
    const posture = detectPosture(
      {
        judge_name: "HOFFMAN, GEOFFREY",
        decision_date: "2026-06-30",
        is_oral_decision: true,
        decision_outcome: "removal_order",
        dispositive_motion_granted: "pretermit",
        reached_merits: false,
      },
      RULES,
    );

    expect(posture?.slug).toBe("pretermision");
    expect(posture?.requiredSourceSlugs).toEqual(["mocion-pretermision-dhs", "transcript-audiencia"]);
  });

  it("detects a merits denial when the judge did reach the merits", () => {
    expect(detectPosture({ reached_merits: true }, RULES)?.slug).toBe("denegacion-de-fondo");
  });

  it("requires EVERY condition of a rule (flat AND, no partial matches)", () => {
    // Pretermission signal present but the merits flag disagrees → not this posture.
    const posture = detectPosture(
      { dispositive_motion_granted: "pretermit", reached_merits: true },
      RULES,
    );
    expect(posture?.slug).toBe("denegacion-de-fondo");
  });

  it("prefers the MORE SPECIFIC rule when several match (specificity = condition count)", () => {
    const loose: PostureRule = {
      slug: "generica",
      conditions: [{ field: "reached_merits", op: "is_false" }],
      requiredSourceSlugs: [],
      questionPlaybookPrompt: null,
    };
    const posture = detectPosture(
      { dispositive_motion_granted: "pretermit", reached_merits: false },
      [loose, PRETERMISSION],
    );
    // 2 conditions beat 1 — precedence lives in CODE, never as a column.
    expect(posture?.slug).toBe("pretermision");
  });

  it("breaks a specificity tie deterministically by slug, so runs are reproducible", () => {
    const a: PostureRule = { slug: "bbb", conditions: [{ field: "x", op: "is_true" }], requiredSourceSlugs: [], questionPlaybookPrompt: null };
    const b: PostureRule = { slug: "aaa", conditions: [{ field: "x", op: "is_true" }], requiredSourceSlugs: [], questionPlaybookPrompt: null };

    expect(detectPosture({ x: true }, [a, b])?.slug).toBe("aaa");
    expect(detectPosture({ x: true }, [b, a])?.slug).toBe("aaa");
  });

  it("returns null when nothing matches — the caller must not guess", () => {
    expect(detectPosture({ reached_merits: null }, RULES)).toBeNull();
    expect(detectPosture({}, RULES)).toBeNull();
  });

  it("returns null for an empty rule set (a service with no postures configured)", () => {
    expect(detectPosture({ reached_merits: true }, [])).toBeNull();
  });

  it("never matches a rule with zero conditions (would match everything)", () => {
    const catchAll: PostureRule = { slug: "todo", conditions: [], requiredSourceSlugs: [], questionPlaybookPrompt: null };
    expect(detectPosture({ anything: 1 }, [catchAll])).toBeNull();
  });

  describe("operators", () => {
    const rule = (op: PostureRule["conditions"][number]["op"], value?: unknown): PostureRule[] => [
      { slug: "r", conditions: [{ field: "f", op, value } as PostureRule["conditions"][number]], requiredSourceSlugs: [], questionPlaybookPrompt: null },
    ];

    it("equals compares strictly (no coercion)", () => {
      expect(detectPosture({ f: "pretermit" }, rule("equals", "pretermit"))?.slug).toBe("r");
      expect(detectPosture({ f: "PRETERMIT" }, rule("equals", "pretermit"))).toBeNull();
      expect(detectPosture({ f: 1 }, rule("equals", "1"))).toBeNull();
    });

    it("not_equals does not match a missing field (absence is not a value)", () => {
      expect(detectPosture({ f: "x" }, rule("not_equals", "y"))?.slug).toBe("r");
      expect(detectPosture({}, rule("not_equals", "y"))).toBeNull();
    });

    it("is_true / is_false require real booleans, not truthiness", () => {
      expect(detectPosture({ f: true }, rule("is_true"))?.slug).toBe("r");
      expect(detectPosture({ f: "true" }, rule("is_true"))).toBeNull();
      expect(detectPosture({ f: 1 }, rule("is_true"))).toBeNull();
      expect(detectPosture({ f: false }, rule("is_false"))?.slug).toBe("r");
      expect(detectPosture({ f: null }, rule("is_false"))).toBeNull();
    });

    it("in matches membership of a list", () => {
      expect(detectPosture({ f: "b" }, rule("in", ["a", "b"]))?.slug).toBe("r");
      expect(detectPosture({ f: "c" }, rule("in", ["a", "b"]))).toBeNull();
      expect(detectPosture({ f: "a" }, rule("in", "a"))).toBeNull(); // malformed value
    });

    it("ignores an unknown operator instead of matching (fail-closed)", () => {
      expect(detectPosture({ f: "x" }, rule("magic" as never, "x"))).toBeNull();
    });
  });
});
