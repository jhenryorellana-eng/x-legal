import { describe, it, expect } from "vitest";
import { buildAnnexesSection, assembleDocument, type ResearchBundle, type GenerationSectionSpec } from "../domain";

function section(over: Partial<GenerationSectionSpec> = {}): GenerationSectionSpec {
  return { key: "i1", heading: "I.1 Intro", min_words: 0, max_tokens: 4000, guidance: "", type: "analysis", ...over };
}

const BUNDLE: ResearchBundle = {
  analysis: null,
  jurisprudence: [
    { name: "Navas v. INS", citation: "217 F.3d 646", court: "9th Cir.", year: "2000", holding: "Imputed political opinion suffices.", factual_analogy: "Like the applicant, Navas was targeted by state agents.", url: "https://courtlistener.com/navas" },
  ],
  country_conditions: [
    { source_name: "Human Rights Watch", author: "HRW", summary: "Crackdown on opposition continues.", full_context: "Detailed reporting on detentions of opposition figures across the country in 2025...", why_it_helps: "Corroborates state persecution.", url: "https://hrw.org/venezuela-2025", published_date: "2025-03-01" },
  ],
};

describe("buildAnnexesSection", () => {
  it("returns empty string when there is nothing to annex", () => {
    expect(buildAnnexesSection({ analysis: null, jurisprudence: [], country_conditions: [] })).toBe("");
  });

  it("renders Exhibit A (jurisprudence) as a field table with holding, application and a real URL", () => {
    const md = buildAnnexesSection(BUNDLE);
    expect(md).toContain("Annexes — Index of Exhibits");
    expect(md).toContain("Exhibit A-1: Navas v. INS");
    expect(md).toContain("| Holding |"); // table-driven cover sheet
    expect(md).toContain("| Application to the present case |");
    expect(md).toContain("217 F.3d 646");
    expect(md).toContain("Imputed political opinion suffices.");
    expect(md).toContain("Like the applicant");
    expect(md).toContain("https://courtlistener.com/navas");
  });

  it("renders Exhibit B (country conditions) as a field table with summary + detailed text", () => {
    const md = buildAnnexesSection(BUNDLE);
    expect(md).toContain("Exhibit B-1");
    expect(md).toContain("Human Rights Watch");
    expect(md).toContain("| Short summary |");
    expect(md).toContain("| Detailed context for the record |");
    expect(md).toContain("Crackdown on opposition continues."); // summary
    expect(md).toContain("Detailed reporting on detentions"); // full detailed text
    expect(md).toContain("https://hrw.org/venezuela-2025");
    expect(md).toContain("2025-03-01");
  });

  it("renders only Exhibit A when there are no country conditions", () => {
    const md = buildAnnexesSection({ analysis: null, jurisprudence: BUNDLE.jurisprudence, country_conditions: [] });
    expect(md).toContain("Exhibit A");
    expect(md).not.toContain("Exhibit B");
  });

  it("renders only Exhibit B when there is no jurisprudence", () => {
    const md = buildAnnexesSection({ analysis: null, jurisprudence: [], country_conditions: BUNDLE.country_conditions });
    expect(md).toContain("Exhibit B");
    expect(md).not.toContain("Exhibit A");
  });

  it("falls back to the summary when full_context is empty", () => {
    const md = buildAnnexesSection({
      analysis: null,
      jurisprudence: [],
      country_conditions: [{ source_name: "Src", author: "", summary: "Short summary here.", full_context: "", why_it_helps: "W", url: "https://x", published_date: "" }],
    });
    expect(md).toContain("Short summary here.");
  });

  it("escapes pipe characters in exhibit table cells so the markdown table is not broken", () => {
    const md = buildAnnexesSection({
      analysis: null,
      jurisprudence: [],
      country_conditions: [{ source_name: "A | B News", author: "", summary: "S", full_context: "C", why_it_helps: "W", url: "https://x", published_date: "" }],
    });
    expect(md).toContain("A \\| B News"); // escaped inside the table cell
  });
});

describe("assembleDocument — annexes block", () => {
  it("appends the annexes after the body when assembly.annexes and an annex is provided", () => {
    const doc = assembleDocument(
      [section()],
      ["## I.1 Intro\n\nbody1"],
      { annexes: true },
      { annexes: "## ANNEXES — INDEX OF EXHIBITS\n\nExhibit A-1..." },
    );
    expect(doc).toContain("body1");
    expect(doc).toContain("ANNEXES");
    expect(doc.indexOf("body1")).toBeLessThan(doc.indexOf("ANNEXES"));
  });
});
