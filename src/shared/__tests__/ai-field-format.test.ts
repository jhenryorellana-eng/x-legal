import { describe, it, expect } from "vitest";
import { normalizeAiFieldText, buildAiFieldInstruction } from "@/shared/form-logic/ai-field-format";

describe("normalizeAiFieldText — run-on numbered lists", () => {
  it("splits a run-on numbered list into one line per ground (the EOIR-26 #6 defect)", () => {
    // Real value produced in PROD on 2026-07-18: zero newlines, so the official
    // form printed one dense paragraph instead of a readable list.
    const raw =
      "1. The Immigration Judge erred in finding me removable/inadmissible (INA § 212(a)(07)(A)(i)(1))." +
      "2. The Immigration Judge erred in denying my asylum application." +
      "3. The Immigration Judge erred in denying my withholding of removal (INA § 241(b)(3))." +
      "A separate written brief in support of this appeal will be timely filed.";

    const r = normalizeAiFieldText(raw);

    expect(r.relisted).toBe(true);
    expect(r.text.split("\n")).toEqual([
      "1. The Immigration Judge erred in finding me removable/inadmissible (INA § 212(a)(07)(A)(i)(1)).",
      "2. The Immigration Judge erred in denying my asylum application.",
      "3. The Immigration Judge erred in denying my withholding of removal (INA § 241(b)(3)).",
      "A separate written brief in support of this appeal will be timely filed.",
    ]);
  });

  it("reshapes the REAL PROD value of 2026-07-18 without corrupting its citations", () => {
    // Verbatim value the EOIR-26 #6 ai_field produced in production (0 newlines).
    // Kept as a fixture because it is the only case that exposed the initialism
    // trap: a naive glued-sentence split shreds "8 C.F.R." into "8 C." / "F." / "R.".
    const raw =
      "1. The Immigration Judge erred in finding me removable/inadmissible (INA § 212(a)(07)(A)(i)(1))." +
      "2. The Immigration Judge erred in denying my asylum application." +
      "3. The Immigration Judge erred in denying my withholding of removal (INA § 241(b)(3))." +
      "4. The Immigration Judge erred in denying my Convention Against Torture application." +
      "5. The Immigration Judge erred in denying my deferral of removal under CAT." +
      "6. The Immigration Judge erred in ordering my removal to Honduras." +
      "7. The Immigration Judge erred in granting DHS's Motion to Pretermit." +
      "8. A motion to remand (8 C.F.R. 1003.2(c)) will accompany the brief for new evidence." +
      "A separate written brief in support of this appeal will be timely filed.";

    const r = normalizeAiFieldText(raw, { maxChars: 2500 });

    expect(r.relisted).toBe(true);
    expect(r.overflow).toBe(false);
    // 8 numbered grounds + the closing sentence, one per line.
    expect(r.text.split("\n")).toHaveLength(9);
    // Citations survive intact.
    expect(r.text).toContain("8 C.F.R. 1003.2(c)");
    expect(r.text).toContain("INA § 212(a)(07)(A)(i)(1)");
    expect(r.text).toContain("INA § 241(b)(3)");
    expect(r.text.split("\n")[8]).toBe(
      "A separate written brief in support of this appeal will be timely filed.",
    );
  });

  it("leaves an already-formatted list untouched (idempotent)", () => {
    const raw = "1. First ground.\n2. Second ground.\n\nA separate brief will follow.";
    const r = normalizeAiFieldText(raw);
    expect(r.relisted).toBe(false);
    expect(r.text).toBe(raw);
  });

  it("is idempotent: normalizing twice equals normalizing once", () => {
    const raw = "1. First ground.2. Second ground.3. Third ground.";
    const once = normalizeAiFieldText(raw).text;
    const twice = normalizeAiFieldText(once).text;
    expect(twice).toBe(once);
  });

  it("NEVER splits legal citations that merely contain digit-dot sequences", () => {
    // "Dec. 721", "1003.2(c)", "§ 241(b)(3)" must survive: a false split would
    // corrupt a citation on a federal filing.
    const raw =
      "The Judge misread Matter of S-M-J-, 21 I&N Dec. 721 (BIA 1997) and " +
      "8 C.F.R. 1003.2(c), as well as INA § 241(b)(3).";
    const r = normalizeAiFieldText(raw);
    expect(r.relisted).toBe(false);
    expect(r.text).toBe(raw);
  });

  it("re-lists a long list that crosses from one digit to two", () => {
    // A record with 12 dispositive grounds is realistic, and every ground must
    // survive: an unchallenged ground is waived on appeal.
    const raw = Array.from({ length: 12 }, (_, i) => `${i + 1}. Ground number ${i + 1} here.`).join("");
    const r = normalizeAiFieldText(raw);
    expect(r.relisted).toBe(true);
    expect(r.text.split("\n")).toHaveLength(12);
    expect(r.text.split("\n")[11]).toBe("12. Ground number 12 here.");
  });

  it("preserves a [TO BE COMPLETED BY PREPARER] placeholder inside an item", () => {
    const raw = "1. The Judge erred as to [TO BE COMPLETED BY PREPARER].2. The Judge erred on nexus.";
    const r = normalizeAiFieldText(raw);
    expect(r.text.split("\n")).toEqual([
      "1. The Judge erred as to [TO BE COMPLETED BY PREPARER].",
      "2. The Judge erred on nexus.",
    ]);
  });

  it.each([
    ["U.S.C.", "The Judge misapplied 8 U.S.C. § 1231(b)(3).The record shows otherwise."],
    ["BIA reporter", "See Matter of A-B-, 27 I&N Dec. 316 (A.G. 2018).The Judge ignored it."],
    ["circuit reporter", "See Zuniga v. Barr, 946 F.3d 464 (9th Cir. 2019).The Judge misread it."],
    ["docket number", "Docket No. 5.The Judge erred."],
    ["currency", "He paid $1,500.00.Then they returned."],
    ["date", "The hearing was on June 30, 2026.The Judge denied all relief."],
    ["honorifics", "Mr. Palma testified.Dr. Reyes corroborated."],
  ])("never rewrites prose that is not a list: %s", (_name, raw) => {
    // The glued-sentence pass runs ONLY inside a detected list; none of these is
    // one, so the text must come back byte-identical. A split here would corrupt
    // a citation on a federal filing.
    const r = normalizeAiFieldText(raw);
    expect(r.relisted).toBe(false);
    expect(r.text).toBe(raw);
  });

  it("re-lists a Spanish list too (the engine is language-agnostic)", () => {
    const raw = "1. El juez erró en la credibilidad.2. El juez erró en el nexo.";
    const r = normalizeAiFieldText(raw);
    expect(r.relisted).toBe(true);
    expect(r.text.split("\n")).toHaveLength(2);
  });

  it("only re-lists when the markers form an ascending 1..N sequence", () => {
    // Prose that happens to contain "2." out of sequence is left alone.
    const raw = "The hearing ended in 2019. 5. was never a ground raised below.";
    const r = normalizeAiFieldText(raw);
    expect(r.relisted).toBe(false);
    expect(r.text).toBe(raw);
  });

  it("does NOT treat a LONE '1.' marker in prose as a list", () => {
    // Regression (review 2026-07-18): the ascending-sequence guard was bypassed
    // whenever the single marker happened to be "1.", so ordinary prose was
    // re-listed — and, worse, that wrongly-set flag let the glued-sentence pass
    // loose over the WHOLE text. A real list needs at least a 1.→2. progression.
    const raw =
      "The panel affirmed the IJ's finding. 1. The respondent maintains that counsel " +
      "was ineffective under Matter of Lozada, 19 I&N Dec. 637 (BIA 1988), warranting reopening.";
    const r = normalizeAiFieldText(raw);
    expect(r.relisted).toBe(false);
    expect(r.text).toBe(raw);
  });

  it("does not let a lone marker unlock glued-sentence rewriting elsewhere", () => {
    // Same root cause, showing the blast radius: "Va.Prior" must not be split
    // just because an unrelated "1." appears later in the text.
    const raw =
      "Respondent last resided in Fairfax, Va.Prior to that in Loudoun County. " +
      "1. The Board should reconsider its prior denial in light of new evidence.";
    const r = normalizeAiFieldText(raw);
    expect(r.relisted).toBe(false);
    expect(r.text).toBe(raw);
  });

  it("still re-lists a genuine two-item list that opens with '1.'", () => {
    // The guard must not over-correct: 1.→2. is the smallest real list.
    const r = normalizeAiFieldText("1. First ground.2. Second ground.");
    expect(r.relisted).toBe(true);
    expect(r.text.split("\n")).toEqual(["1. First ground.", "2. Second ground."]);
  });

  it("normalizes CRLF and collapses runs of blank lines", () => {
    const r = normalizeAiFieldText("  1. One.\r\n\r\n\r\n\r\n2. Two.  ");
    expect(r.text).toBe("1. One.\n\n2. Two.");
  });

  it("returns empty text for blank input without claiming an overflow", () => {
    const r = normalizeAiFieldText("   \n  ");
    expect(r.text).toBe("");
    expect(r.overflow).toBe(false);
    expect(r.relisted).toBe(false);
  });
});

describe("normalizeAiFieldText — maxChars ceiling", () => {
  it("flags overflow WITHOUT truncating (never silently cut a legal filing)", () => {
    const raw = "x".repeat(50);
    const r = normalizeAiFieldText(raw, { maxChars: 20 });
    expect(r.overflow).toBe(true);
    expect(r.text).toBe(raw); // full text preserved
    expect(r.text.length).toBe(50);
  });

  it("does not flag overflow when within the ceiling", () => {
    const r = normalizeAiFieldText("short", { maxChars: 20 });
    expect(r.overflow).toBe(false);
  });

  it("treats a 0 / missing ceiling as unbounded", () => {
    expect(normalizeAiFieldText("x".repeat(9000), { maxChars: 0 }).overflow).toBe(false);
    expect(normalizeAiFieldText("x".repeat(9000)).overflow).toBe(false);
  });

  it("measures the NORMALIZED text, not the raw text", () => {
    // Re-listing adds newlines; the ceiling applies to what actually renders.
    const raw = "1. Aaaa.2. Bbbb.";
    const r = normalizeAiFieldText(raw, { maxChars: raw.length });
    expect(r.relisted).toBe(true);
    expect(r.overflow).toBe(true); // one char longer after the inserted newline
  });
});

describe("buildAiFieldInstruction — the ceiling is declared once, in config", () => {
  it("appends the character limit so the admin never hand-writes it in prose", () => {
    const out = buildAiFieldInstruction("Draft the reasons for appeal.", { maxChars: 600 });
    expect(out).toContain("Draft the reasons for appeal.");
    expect(out).toContain("600");
  });

  it("returns the instruction unchanged when no ceiling is configured", () => {
    expect(buildAiFieldInstruction("Draft it.", {})).toBe("Draft it.");
    expect(buildAiFieldInstruction("Draft it.", { maxChars: 0 })).toBe("Draft it.");
  });
});
