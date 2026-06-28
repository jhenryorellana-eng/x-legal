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
  type ResearchBundle,
} from "../domain";

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
