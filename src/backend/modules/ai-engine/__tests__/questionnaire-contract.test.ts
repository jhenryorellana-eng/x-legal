import { describe, it, expect } from "vitest";

import {
  ANSWERABLE_FROM,
  questionKeyOf,
  resolveAnswerableFrom,
} from "@/backend/modules/ai-engine/domain";

/**
 * Wave 1 / D2 — the question contract is only as trustworthy as the CODE that
 * verifies what the model claimed. These tests pin the two invariants that make
 * `record_confirm` safe: evidence must really exist in the corpus, and validation
 * may only ever DEGRADE a claim, never promote one.
 */

const CORPUS = [
  "Respondent's counsel submitted a brief proposing seven particular social groups.",
  "The lead proposed group is 'Honduran small business owners targeted for extortion by Pandilla 18'.",
  "Exhibit K contains the sworn affidavit of Josue David Palma Rodriguez.",
].join("\n");

describe("questionKeyOf — stable identity across regenerations", () => {
  it("is deterministic for the same text", () => {
    const a = questionKeyOf("¿Qué dijo el juez sobre su credibilidad?");
    const b = questionKeyOf("¿Qué dijo el juez sobre su credibilidad?");
    expect(a).toBe(b);
    expect(a).not.toHaveLength(0);
  });

  it("ignores accents, case, punctuation and whitespace noise", () => {
    const canonical = questionKeyOf("¿Qué dijo el juez sobre su credibilidad?");
    expect(questionKeyOf("Que dijo el JUEZ sobre su credibilidad")).toBe(canonical);
    expect(questionKeyOf("  ¿Qué   dijo el juez,  sobre su credibilidad?  ")).toBe(canonical);
  });

  it("differs for semantically different questions", () => {
    expect(questionKeyOf("¿Qué dijo el juez sobre su credibilidad?")).not.toBe(
      questionKeyOf("¿Qué dijo el juez sobre su grupo social?"),
    );
  });

  it("returns a stable key for empty/garbage input without throwing", () => {
    expect(typeof questionKeyOf("")).toBe("string");
    expect(questionKeyOf("")).toBe(questionKeyOf(""));
  });
});

describe("resolveAnswerableFrom — validation only degrades", () => {
  it("exposes the closed contract", () => {
    expect([...ANSWERABLE_FROM]).toEqual(["record_confirm", "record", "client_only"]);
  });

  it("keeps record_confirm when the span exists AND the prefill is contained in it", () => {
    const out = resolveAnswerableFrom({
      claimed: "record_confirm",
      prefillValue: "seven particular social groups",
      evidenceRefs: [{ document: "asilo", span: "counsel submitted a brief proposing seven particular social groups" }],
      corpus: CORPUS,
    });
    expect(out.answerableFrom).toBe("record_confirm");
    expect(out.prefillValue).toBe("seven particular social groups");
  });

  it("tolerates accent/case/whitespace differences between prefill, span and corpus", () => {
    const out = resolveAnswerableFrom({
      claimed: "record_confirm",
      prefillValue: "EXHIBIT   K",
      evidenceRefs: [{ document: "asilo", span: "Exhibit K contains the sworn affidavit" }],
      corpus: CORPUS,
    });
    expect(out.answerableFrom).toBe("record_confirm");
  });

  it("DEGRADES to client_only when the cited span is not in the corpus (hallucinated citation)", () => {
    const out = resolveAnswerableFrom({
      claimed: "record_confirm",
      prefillValue: "the judge found her not credible",
      evidenceRefs: [{ document: "decision", span: "the Court found Respondent not credible" }],
      corpus: CORPUS,
    });
    expect(out.answerableFrom).toBe("client_only");
    expect(out.prefillValue).toBeNull();
  });

  it("DEGRADES when the span is real but the prefill is not supported by it (invented detail)", () => {
    const out = resolveAnswerableFrom({
      claimed: "record_confirm",
      prefillValue: "nine particular social groups",
      evidenceRefs: [{ document: "asilo", span: "counsel submitted a brief proposing seven particular social groups" }],
      corpus: CORPUS,
    });
    expect(out.answerableFrom).toBe("client_only");
    expect(out.prefillValue).toBeNull();
  });

  it("DEGRADES when record_confirm carries no evidence at all", () => {
    for (const refs of [null, []]) {
      const out = resolveAnswerableFrom({
        claimed: "record_confirm",
        prefillValue: "something",
        evidenceRefs: refs,
        corpus: CORPUS,
      });
      expect(out.answerableFrom).toBe("client_only");
    }
  });

  it("DEGRADES when record_confirm carries evidence but an empty prefill", () => {
    const out = resolveAnswerableFrom({
      claimed: "record_confirm",
      prefillValue: "   ",
      evidenceRefs: [{ document: "asilo", span: "Exhibit K contains the sworn affidavit" }],
      corpus: CORPUS,
    });
    expect(out.answerableFrom).toBe("client_only");
  });

  it("NEVER promotes client_only, even with perfectly valid evidence", () => {
    const out = resolveAnswerableFrom({
      claimed: "client_only",
      prefillValue: "Exhibit K",
      evidenceRefs: [{ document: "asilo", span: "Exhibit K contains the sworn affidavit" }],
      corpus: CORPUS,
    });
    expect(out.answerableFrom).toBe("client_only");
    expect(out.prefillValue).toBeNull();
  });

  it("NEVER promotes record to record_confirm", () => {
    const out = resolveAnswerableFrom({
      claimed: "record",
      prefillValue: "Exhibit K",
      evidenceRefs: [{ document: "asilo", span: "Exhibit K contains the sworn affidavit" }],
      corpus: CORPUS,
    });
    expect(out.answerableFrom).toBe("record");
    expect(out.prefillValue).toBeNull();
  });

  it("falls back to record (draftable, never prefilled) for a missing or unrecognised claim", () => {
    // Deliberate: with the gap-filler gone an unanswerable question yields an
    // EMPTY draft and the gate blocks, so letting the drafting pass try is safe.
    // Defaulting to client_only would turn any prompt drift into manual typing.
    for (const claimed of [undefined, "", "magic", "RECORD_CONFIRM!"]) {
      const out = resolveAnswerableFrom({
        claimed,
        prefillValue: "Exhibit K",
        evidenceRefs: [{ document: "asilo", span: "Exhibit K contains the sworn affidavit" }],
        corpus: CORPUS,
      });
      expect(out.answerableFrom).toBe("record");
      // The unverified prefill is dropped either way — that part stays fail-closed.
      expect(out.prefillValue).toBeNull();
    }
  });

  it("degrades every record_confirm when the corpus is empty", () => {
    const out = resolveAnswerableFrom({
      claimed: "record_confirm",
      prefillValue: "Exhibit K",
      evidenceRefs: [{ document: "asilo", span: "Exhibit K contains the sworn affidavit" }],
      corpus: "",
    });
    expect(out.answerableFrom).toBe("client_only");
  });
});
