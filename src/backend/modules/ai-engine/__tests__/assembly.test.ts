import { describe, it, expect } from "vitest";
import {
  assembleDocument,
  buildCoverPage,
  buildSectionUserMessage,
  stripLeadingHeading,
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
  it("removes an echoed section heading that follows an orphan continuity fragment + separator", () => {
    // The model bled the previous section's tail into a lead-in, then re-stated its
    // own heading (em-dash → --, & → and) before the real content.
    const expected = "I.7 Narrative of Past Persecution — Part C: Final Events, Flight & Arrival";
    const body =
      "the sworn account corroborates the country-conditions evidence.\n\n---\n\n## I.7 Narrative of Past Persecution -- Part C: Final Events, Flight, and Arrival\n\n### A. The Point of No Return\n\nThe events documented in Part B...";
    const out = stripLeadingHeading(body, expected);
    expect(out.startsWith("### A. The Point of No Return")).toBe(true);
    expect(out).not.toContain("the sworn account corroborates");
    expect(out).not.toContain("## I.7");
  });
  it("strips the leading heading when it matches the expected heading (clean case)", () => {
    expect(stripLeadingHeading("## I.11 Nexus & Application\n\nThe nexus...", "I.11 Nexus & Application")).toBe("The nexus...");
  });
  it("does not strip a non-matching heading when an expected heading is given", () => {
    const out = stripLeadingHeading("Some intro paragraph.\n\n### A. Background\n\nbody text here", "I.5 Narrative of Past Persecution");
    expect(out).toContain("### A. Background");
    expect(out).toContain("body text here");
  });
});

function section(over: Partial<GenerationSectionSpec> = {}): GenerationSectionSpec {
  return { key: "i1", heading: "I.1 Intro", min_words: 0, max_tokens: 4000, guidance: "", type: "analysis", ...over };
}

describe("buildCoverPage", () => {
  it("resolves {{tokens}} from the context into the default cover rows; no internal case number", () => {
    const md = buildCoverPage(null, {
      applicant_name: "Juan Pérez",
      nationality: "Venezuela",
      principal_theory: "Individualized persecution by state agents.",
      entry_date: "2024-03-15",
    });
    expect(md).toContain("Juan Pérez"); // heading
    expect(md).toContain("Venezuela");
    expect(md).toContain("Individualized persecution by state agents.");
    expect(md).toContain("2024-03-15");
    expect(md).not.toMatch(/case number/i); // internal code never on a court cover
  });

  it("uses the configured title + rows (config-driven, supports static text)", () => {
    const md = buildCoverPage(
      { title: "MY CUSTOM TITLE", rows: [{ label: "Client", value: "{{applicant_name}}" }, { label: "File", value: "Static text" }] },
      { applicant_name: "Ana" },
    );
    expect(md).toContain("# MY CUSTOM TITLE");
    expect(md).toContain("| Client | Ana |");
    expect(md).toContain("| File | Static text |");
  });

  it("renders an em-dash for a row whose tokens do not resolve", () => {
    const md = buildCoverPage({ rows: [{ label: "Court", value: "{{court}}" }] }, {});
    expect(md).toContain("| Court | — |");
  });

  it("escapes pipe characters so an odd value cannot break the table", () => {
    const md = buildCoverPage({ rows: [{ label: "Name", value: "{{applicant_name}}" }] }, { applicant_name: "Evil | Name" });
    expect(md).toContain("Evil \\| Name");
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

  it("honors the configured block order, splitting the last section as the conclusions", () => {
    const secs3 = [section({ heading: "I.1 A" }), section({ key: "i2", heading: "I.2 B" }), section({ key: "i3", heading: "I.3 Conclusions" })];
    const parts3 = ["## I.1 A\n\nAAA", "## I.2 B\n\nBBB", "## I.3 Conclusions\n\nCCC"];
    const doc = assembleDocument(
      secs3,
      parts3,
      {
        blocks: [{ type: "body" }, { type: "chronology" }, { type: "conclusions" }, { type: "annexes" }, { type: "closing" }],
        closing: "PERJURY TEXT",
      },
      { chronology: "| Date |\n| --- |\n| 2021 |", annexes: "## Annexes\n\nEXHIBIT" },
    );
    // order: body(AAA,BBB) → chronology → conclusions(CCC) → annexes → closing
    expect(doc.indexOf("BBB")).toBeLessThan(doc.indexOf("| Date |"));
    expect(doc.indexOf("| Date |")).toBeLessThan(doc.indexOf("CCC"));
    expect(doc.indexOf("CCC")).toBeLessThan(doc.indexOf("EXHIBIT"));
    expect(doc.indexOf("EXHIBIT")).toBeLessThan(doc.indexOf("PERJURY TEXT"));
    // the body block must not carry the conclusion section
    expect(doc.indexOf("BBB")).toBeLessThan(doc.indexOf("CCC"));
  });

  it("disabled blocks are skipped even if their extra is provided", () => {
    const doc = assembleDocument(secs, parts, { blocks: [{ type: "body" }, { type: "annexes", enabled: false }] }, { annexes: "## Annexes\n\nEXHIBIT" });
    expect(doc).toContain("body1");
    expect(doc).not.toContain("EXHIBIT");
  });

  it("inserts a page break before page-starting blocks (cover/toc/annexes/closing)", () => {
    const doc = assembleDocument(secs, parts, { cover: true, annexes: true }, { cover: "# COVER", annexes: "## Annexes\n\nEXHIBIT" });
    // cover is first (no leading break); body and annexes start fresh pages
    expect(doc).toContain("<<<PAGEBREAK>>>");
    expect(doc.split("<<<PAGEBREAK>>>").length - 1).toBeGreaterThanOrEqual(2);
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
