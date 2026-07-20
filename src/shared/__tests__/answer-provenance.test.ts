import { describe, it, expect } from "vitest";

import {
  ANSWER_PROVENANCES,
  type AnswerProvenance,
  isClientAuthored,
  countsAsAnswered,
  mergeProvenance,
  coverageOf,
  parseProvenanceMap,
} from "@/shared/constants/answer-provenance";

describe("answer-provenance — state machine", () => {
  it("exposes the closed set of provenances", () => {
    expect([...ANSWER_PROVENANCES]).toEqual([
      "client_edited",
      "client_confirmed",
      "ai_grounded",
      "source_resolved",
      "schema_default",
      "ai_gap_filled",
      "unknown",
    ]);
  });

  describe("isClientAuthored", () => {
    it("is true only for the two client_* states", () => {
      expect(isClientAuthored("client_edited")).toBe(true);
      expect(isClientAuthored("client_confirmed")).toBe(true);
      for (const p of ["ai_grounded", "source_resolved", "schema_default", "ai_gap_filled", "unknown"] as const) {
        expect(isClientAuthored(p)).toBe(false);
      }
    });
  });

  describe("mergeProvenance — human touch wins and is terminal", () => {
    it("promotes an AI draft to client_edited when the client types over it", () => {
      expect(mergeProvenance("ai_grounded", "client_edited")).toBe("client_edited");
      expect(mergeProvenance("ai_gap_filled", "client_edited")).toBe("client_edited");
      expect(mergeProvenance("schema_default", "client_confirmed")).toBe("client_confirmed");
    });

    it("NEVER reverts a client_* state back to an ai_* state", () => {
      // A regeneration must not erase the fact that a human authored this answer.
      expect(mergeProvenance("client_edited", "ai_grounded")).toBe("client_edited");
      expect(mergeProvenance("client_edited", "ai_gap_filled")).toBe("client_edited");
      expect(mergeProvenance("client_confirmed", "ai_grounded")).toBe("client_confirmed");
      expect(mergeProvenance("client_confirmed", "schema_default")).toBe("client_confirmed");
    });

    it("lets client_edited supersede client_confirmed (editing is stronger than confirming)", () => {
      expect(mergeProvenance("client_confirmed", "client_edited")).toBe("client_edited");
      expect(mergeProvenance("client_edited", "client_confirmed")).toBe("client_edited");
    });

    it("treats unknown as the weakest state — anything overwrites it", () => {
      for (const p of ANSWER_PROVENANCES) {
        if (p === "unknown") continue;
        expect(mergeProvenance("unknown", p)).toBe(p);
      }
    });

    it("prefers grounded over gap-filled when both are AI", () => {
      expect(mergeProvenance("ai_gap_filled", "ai_grounded")).toBe("ai_grounded");
      expect(mergeProvenance("ai_grounded", "ai_gap_filled")).toBe("ai_grounded");
    });
  });

  describe("countsAsAnswered — the completeness gate contract", () => {
    it("counts real client input and grounded/resolved values", () => {
      expect(countsAsAnswered("client_edited")).toBe(true);
      expect(countsAsAnswered("client_confirmed")).toBe(true);
      expect(countsAsAnswered("ai_grounded")).toBe(true);
      expect(countsAsAnswered("source_resolved")).toBe(true);
      expect(countsAsAnswered("schema_default")).toBe(true);
    });

    it("does NOT count ai_gap_filled — the regression that let a 36% case reach approved", () => {
      expect(countsAsAnswered("ai_gap_filled")).toBe(false);
    });

    it("does NOT count unknown — backfilled history is not evidence of an answer", () => {
      expect(countsAsAnswered("unknown")).toBe(false);
    });
  });

  describe("coverageOf", () => {
    it("reproduces the real case: 25 answers, 15 filler, 1 default => 40% counted", () => {
      const map: Record<string, AnswerProvenance> = {};
      for (let i = 0; i < 9; i++) map[`g${i}`] = "ai_grounded";
      for (let i = 0; i < 15; i++) map[`f${i}`] = "ai_gap_filled";
      map.d0 = "schema_default";

      const cov = coverageOf(map);
      expect(cov.total).toBe(25);
      expect(cov.answered).toBe(10); // 9 grounded + 1 default
      expect(cov.gapFilled).toBe(15);
      expect(cov.clientAuthored).toBe(0);
      expect(cov.pct).toBe(40);
    });

    it("reports 100% when every answer is client-authored", () => {
      const cov = coverageOf({ a: "client_edited", b: "client_confirmed" });
      expect(cov.pct).toBe(100);
      expect(cov.clientAuthored).toBe(2);
    });

    it("returns 0% (not NaN) for an empty map", () => {
      expect(coverageOf({}).pct).toBe(0);
    });
  });

  describe("parseProvenanceMap — tolerant of legacy/garbage jsonb", () => {
    it("keeps known values and maps anything unrecognised to unknown", () => {
      const parsed = parseProvenanceMap({ a: "ai_grounded", b: "nonsense", c: 42, d: null });
      expect(parsed).toEqual({ a: "ai_grounded", b: "unknown", c: "unknown", d: "unknown" });
    });

    it("returns an empty map for null/non-object input", () => {
      expect(parseProvenanceMap(null)).toEqual({});
      expect(parseProvenanceMap("nope")).toEqual({});
      expect(parseProvenanceMap([1, 2])).toEqual({});
    });
  });
});
