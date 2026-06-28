import { describe, it, expect } from "vitest";
import {
  assembleDocument,
  buildCoverPage,
  buildSectionUserMessage,
  stripLeadingHeading,
  type ResearchAnalysis,
  type GenerationSectionSpec,
} from "../domain";

describe("stripLeadingHeading", () => {
  it("removes a leading markdown heading the model echoed (avoids a duplicate)", () => {
    expect(stripLeadingHeading("## I.11 Nexus\n\nThe nexus analysis...")).toBe("The nexus analysis...");
    expect(stripLeadingHeading("###   I.5 Narrative\nFirst incident...")).toBe("First incident...");
  });
  it("leaves a body that does not start with a heading untouched", () => {
    expect(stripLeadingHeading("The nexus analysis...")).toBe("The nexus analysis...");
  });
  it("tolerates leading blank lines before the heading", () => {
    expect(stripLeadingHeading("\n\n## I.11 Nexus\n\nbody")).toBe("body");
  });
});

function section(over: Partial<GenerationSectionSpec> = {}): GenerationSectionSpec {
  return { key: "i1", heading: "I.1 Intro", min_words: 0, max_tokens: 4000, guidance: "", type: "analysis", ...over };
}

const analysis: ResearchAnalysis = {
  nationality: "Venezuela",
  persecution_type: "political opinion",
  protected_grounds: ["political opinion"],
  perpetrator: "GNB",
  state_action: "state actor",
  principal_theory: "Individualized persecution by state agents.",
  summary: "…",
  chronology: [],
};

describe("buildCoverPage", () => {
  it("renders the title and a data table from caseMeta + analysis", () => {
    const md = buildCoverPage(analysis, {
      applicantName: "Juan Pérez",
      caseNumber: "ULP-2026-0009",
      court: "Pending",
      aNumber: "Pending",
      entryDate: "2024-03-15",
    });
    expect(md).toContain("Juan Pérez");
    expect(md).toContain("Venezuela");
    expect(md).toContain("Individualized persecution by state agents.");
    expect(md).toContain("2024-03-15");
    expect(md).toContain("ULP-2026-0009");
  });

  it("falls back gracefully when analysis is null", () => {
    const md = buildCoverPage(null, { applicantName: "Ana" });
    expect(md).toContain("Ana");
    expect(md).toContain("Pending");
  });

  it("escapes pipe characters so a malicious/odd value cannot break the table", () => {
    const md = buildCoverPage(null, { applicantName: "Evil | Name", court: "A | B" });
    expect(md).toContain("Evil \\| Name");
    expect(md).toContain("A \\| B");
  });
});

describe("assembleDocument — court assembly", () => {
  const secs = [section({ heading: "I.1 Intro" }), section({ key: "i2", heading: "I.2 Jurisdiction" })];
  const parts = ["## I.1 Intro\n\nbody1", "## I.2 Jurisdiction\n\nbody2"];

  it("still joins section parts with no assembly (back-compat)", () => {
    const doc = assembleDocument(secs, parts, null);
    expect(doc).toContain("body1");
    expect(doc).toContain("body2");
  });

  it("prepends the cover when assembly.cover and a cover is provided", () => {
    const doc = assembleDocument(secs, parts, { cover: true }, { cover: "# COVER PAGE" });
    expect(doc.indexOf("# COVER PAGE")).toBeLessThan(doc.indexOf("body1"));
  });

  it("inserts the chronology table after the sections when configured", () => {
    const doc = assembleDocument(secs, parts, { chronology: true }, { chronology: "| Date |\n| --- |\n| 2021 |" });
    expect(doc).toContain("| Date |");
    expect(doc.indexOf("body2")).toBeLessThan(doc.indexOf("| Date |"));
  });

  it("appends the closing (perjury/signature) after the body", () => {
    const doc = assembleDocument(secs, parts, { closing: "I declare under penalty of perjury…" });
    expect(doc).toContain("I declare under penalty of perjury…");
    expect(doc.indexOf("body2")).toBeLessThan(doc.indexOf("penalty of perjury"));
  });
});

describe("buildSectionUserMessage — per-section context (chronological window)", () => {
  it("injects the section-context block when provided", () => {
    const msg = buildSectionUserMessage(
      "CTX",
      section({ type: "narrative", heading: "I.5 Narrative" }),
      "",
      null,
      "<chronological_window>\nEvent 1\n</chronological_window>",
    );
    expect(msg).toContain("chronological_window");
    expect(msg).toContain("Event 1");
  });
});
