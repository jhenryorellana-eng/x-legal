import { describe, it, expect } from "vitest";
import {
  extractJson,
  parseResearchAnalysis,
  parseJurisprudence,
  parseCountryConditions,
  buildResearchContextBlock,
  buildAnalysisPrompt,
  buildJurisprudencePrompt,
  buildCountryConditionsPrompt,
  parsePrecedent,
  datasetToJurisprudence,
  datasetToCountry,
  parseAnalogies,
  type ResearchBundle,
  type DatasetItem,
} from "../domain";

function dsItem(over: Partial<DatasetItem> = {}): DatasetItem {
  return { id: "x", title: "", content: "", tags: [], outcome: "granted", token_count: 10, created_at: "2025-01-01", jurisdiction: null, ...over };
}

describe("extractJson", () => {
  it("parses a raw JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses a fenced ```json block", () => {
    expect(extractJson('here:\n```json\n{"a":2}\n```\nthanks')).toEqual({ a: 2 });
  });
  it("extracts the JSON object embedded in prose", () => {
    expect(extractJson('The result is {"cases": []} done.')).toEqual({ cases: [] });
  });
  it("returns null when there is no JSON", () => {
    expect(extractJson("no json here")).toBeNull();
  });
  it("extracts a balanced object even when prose with stray braces trails it", () => {
    // web_search narration often appends prose (with its own braces) after the JSON.
    expect(extractJson('Here are the results:\n{"items": [{"x": 1}]}\nThat concludes {citation 3}.')).toEqual({
      items: [{ x: 1 }],
    });
  });
});

describe("parseJurisprudence", () => {
  it("accepts the {cases:[...]} wrapper and maps factual_analogy_to_applicant", () => {
    const out = parseJurisprudence(
      JSON.stringify({
        cases: [
          {
            name: "Doe v. INS",
            citation: "123 F.3d 1 (9th Cir. 1999)",
            court: "9th Cir.",
            year: "1999",
            holding: "Held the thing.",
            factual_analogy_to_applicant: "Like the applicant…",
            url: "https://courtlistener.com/x",
          },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Doe v. INS");
    expect(out[0].factual_analogy).toBe("Like the applicant…");
    expect(out[0].url).toBe("https://courtlistener.com/x");
  });

  it("accepts a bare array and defaults a missing url to empty string", () => {
    const out = parseJurisprudence('[{"name":"A v. B","citation":"1 F.4th 2"}]');
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("");
  });

  it("drops entries missing name or citation, and returns [] on garbage", () => {
    expect(parseJurisprudence('{"cases":[{"holding":"x"}]}')).toEqual([]);
    expect(parseJurisprudence("not json")).toEqual([]);
  });

  it("tolerates alternative wrapper keys and name aliases", () => {
    const out = parseJurisprudence('{"precedents":[{"case_name":"A v. B","citation":"1 F.4th 2"}]}');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("A v. B");
  });
});

describe("parseCountryConditions", () => {
  it("maps executive_summary→summary and keeps verified fields", () => {
    const out = parseCountryConditions(
      JSON.stringify({
        items: [
          {
            source_name: "Human Rights Watch",
            author: "HRW",
            executive_summary: "Impunity is widespread.",
            full_context: "Long context…",
            why_it_helps: "Corroborates state failure.",
            url: "https://hrw.org/x",
            published_date: "2025-02-01",
          },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].source_name).toBe("Human Rights Watch");
    expect(out[0].summary).toBe("Impunity is widespread.");
    expect(out[0].why_it_helps).toBe("Corroborates state failure.");
  });

  it("drops entries with no source_name", () => {
    expect(parseCountryConditions('{"items":[{"summary":"x"}]}')).toEqual([]);
  });

  it("tolerates a `sources` wrapper and `source`/`excerpt` field aliases", () => {
    const out = parseCountryConditions(
      '{"sources":[{"source":"Reuters","excerpt":"Crackdown continues.","why_it_helps":"W","url":"https://r"}]}',
    );
    expect(out).toHaveLength(1);
    expect(out[0].source_name).toBe("Reuters");
    expect(out[0].summary).toBe("Crackdown continues.");
  });
});

describe("parseResearchAnalysis", () => {
  it("parses the structured analysis including the chronology", () => {
    const a = parseResearchAnalysis(
      JSON.stringify({
        nationality: "Venezuela",
        persecution_type: "political opinion",
        protected_grounds: ["political opinion"],
        perpetrator: "state agents (GNB)",
        state_action: "direct state actor",
        principal_theory: "Individualized persecution by state agents.",
        summary: "Applicant targeted for opposition activity.",
        chronology: [
          { date: "2021-05-10", event: "First threat", consequence: "Fear", exhibit: null },
        ],
      }),
    );
    expect(a).not.toBeNull();
    expect(a!.nationality).toBe("Venezuela");
    expect(a!.protected_grounds).toEqual(["political opinion"]);
    expect(a!.chronology).toHaveLength(1);
    expect(a!.chronology[0].event).toBe("First threat");
  });

  it("returns null on unparseable input", () => {
    expect(parseResearchAnalysis("garbage")).toBeNull();
  });
});

describe("buildResearchContextBlock", () => {
  const bundle: ResearchBundle = {
    analysis: null,
    jurisprudence: [
      { name: "Doe v. INS", citation: "123 F.3d 1", court: "9th Cir.", year: "1999", holding: "H", factual_analogy: "FA", url: "https://x" },
    ],
    country_conditions: [
      { source_name: "HRW", author: "", summary: "S", full_context: "FC", why_it_helps: "WHY", url: "https://y", published_date: "2025-01-01" },
    ],
  };

  it("renders verified jurisprudence and country-conditions blocks the sections can cite", () => {
    const block = buildResearchContextBlock(bundle);
    expect(block).toContain("verified_jurisprudence");
    expect(block).toContain("Doe v. INS");
    expect(block).toContain("123 F.3d 1");
    expect(block).toContain("https://x");
    expect(block).toContain("country_conditions");
    expect(block).toContain("HRW");
    expect(block).toContain("WHY");
  });

  it("labels each source by its exhibit tab (A-n jurisprudence, B-n country) so the body cites inline", () => {
    const block = buildResearchContextBlock(bundle);
    expect(block).toContain("Exhibit A-1: Doe v. INS");
    expect(block).toContain("Exhibit B-1: HRW");
    // instructs the model to reference exhibits inline and NOT reproduce a table
    expect(block).toMatch(/cite .*inline.*exhibit/i);
    expect(block).toMatch(/do not .*(table|index)/i);
  });

  it("returns an empty string when there is nothing verified", () => {
    expect(buildResearchContextBlock({ analysis: null, jurisprudence: [], country_conditions: [] })).toBe("");
  });
});

describe("research prompt builders (config-driven)", () => {
  it("analysis prompt asks for structured JSON and folds in the admin system prompt", () => {
    const { system, user } = buildAnalysisPrompt({ systemPrompt: "ADMIN FRAMING", caseContext: "CASE CTX" });
    expect(system).toContain("JSON");
    expect(system).toContain("ADMIN FRAMING");
    expect(user).toContain("CASE CTX");
  });

  it("jurisprudence prompt requires web_search + strict JSON and injects admin instructions", () => {
    const { system, user } = buildJurisprudencePrompt({ instructions: "Find federal precedents by nationality.", analysis: null });
    expect(system).toContain("web_search");
    expect(system).toContain("cases");
    expect(system.toLowerCase()).toContain("never");
    expect(user).toContain("Find federal precedents by nationality.");
  });

  it("country-conditions prompt requires strict JSON and injects admin instructions", () => {
    const { system, user } = buildCountryConditionsPrompt({ instructions: "Find recent HRW reporting.", analysis: null });
    expect(system).toContain("items");
    expect(user).toContain("Find recent HRW reporting.");
  });
});

describe("parsePrecedent", () => {
  it("parses name/citation/court/year from a title and url from meta", () => {
    const c = parsePrecedent(dsItem({ title: "Navas v. INS, 217 F.3d 646 (9th Cir. 2000)", content: "Imputed political opinion suffices.", jurisdiction: "9th Cir.", meta: { kind: "precedent", url: "https://courtlistener.com/x" } }));
    expect(c).not.toBeNull();
    expect(c!.name).toBe("Navas v. INS");
    expect(c!.citation).toBe("217 F.3d 646");
    expect(c!.year).toBe("2000");
    expect(c!.court).toBe("9th Cir.");
    expect(c!.holding).toContain("Imputed political opinion");
    expect(c!.url).toBe("https://courtlistener.com/x");
    expect(c!.factual_analogy).toBe(""); // filled later by the analogy step
  });
  it("falls back to the citation in content when the title lacks it", () => {
    const c = parsePrecedent(dsItem({ title: "Matter of Acosta (BIA 1985)", content: "Matter of Acosta, 19 I&N Dec. 211 (BIA 1985): immutable characteristic.", jurisdiction: "BIA", meta: { kind: "precedent" } }));
    expect(c!.citation).toBe("19 I&N Dec. 211");
    expect(c!.name).toBe("Matter of Acosta");
  });
  it("returns null for NGO model declarations and country sources", () => {
    expect(parsePrecedent(dsItem({ title: "CLINIC toolkit", outcome: "model", meta: { kind: "model" } }))).toBeNull();
    expect(parsePrecedent(dsItem({ title: "HRW Venezuela", meta: { kind: "country" } }))).toBeNull();
  });
});

describe("datasetToJurisprudence", () => {
  const items = [
    dsItem({ id: "a", title: "INS v. Cardoza-Fonseca, 480 U.S. 421 (1987)", content: "WFF standard.", tags: ["well_founded_fear"], outcome: "granted" }),
    dsItem({ id: "b", title: "Sangha v. INS, 103 F.3d 1482 (9th Cir. 1997)", content: "Nexus.", tags: ["political_opinion", "nexus"], outcome: "denied" }),
    dsItem({ id: "c", title: "CLINIC toolkit", outcome: "model", meta: { kind: "model" } }),
  ];
  it("returns only precedents, ranked by tag overlap with the analysis then granted", () => {
    const analysis = { nationality: "Venezuela", persecution_type: "political opinion", protected_grounds: ["political opinion"], perpetrator: "state", state_action: "state actor" as const, principal_theory: "T", summary: "S", chronology: [] };
    const cases = datasetToJurisprudence(items, analysis, 6);
    expect(cases).toHaveLength(2); // model excluded
    expect(cases[0].name).toBe("Sangha v. INS"); // higher tag overlap (political_opinion)
  });
  it("respects the max", () => {
    expect(datasetToJurisprudence(items, null, 1)).toHaveLength(1);
  });
});

describe("parseAnalogies", () => {
  it("aligns analogies to precedent indices", () => {
    const out = parseAnalogies(JSON.stringify({ analogies: [{ i: 2, factual_analogy: "B" }, { i: 1, factual_analogy: "A" }] }), 3);
    expect(out).toEqual(["A", "B", ""]);
  });
  it("returns empty strings on unparseable input", () => {
    expect(parseAnalogies("not json", 2)).toEqual(["", ""]);
  });
});

describe("datasetToCountry", () => {
  it("maps only items explicitly tagged kind=country", () => {
    const out = datasetToCountry([
      dsItem({ title: "HRW Venezuela", content: "Crackdown.", meta: { kind: "country", url: "https://hrw.org", year: "2024" } }),
      dsItem({ title: "Cardoza", meta: { kind: "precedent" } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source_name).toBe("HRW Venezuela");
    expect(out[0].url).toBe("https://hrw.org");
    expect(out[0].published_date).toBe("2024");
  });
});
