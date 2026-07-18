/**
 * Catalog domain — ai_field `connected.context_slugs` (multi-document interpreter).
 *
 * Ola Apelación: an ai_field (kind: document) may attach ADDITIONAL requirement
 * documents as context (e.g. EOIR-26 item #6 reads the judge's decision PLUS the
 * asylum package and new evidence). The schema must accept the optional list and
 * publication validation must verify every context slug is a real requirement.
 */

import { describe, it, expect } from "vitest";

import { GenerationSectionSchema, SourceRefSchema, validateSourceRef, type Question, type VersionCtx } from "../domain";

const CTX: VersionCtx = {
  documentSlugsWithSchema: {},
  aiLetterSlugs: ["carta"],
  profileFields: [],
  allDocumentSlugs: [
    "decision-y-orden-del-juez-de-inmigracion",
    "asilo-presentado-completo-con-anexos",
    "evidencias-sustentatorias",
  ],
};

function aiFieldQuestion(connected: Record<string, unknown>): Question {
  return {
    source: "ai_field",
    source_ref: { connected, instruction: "Redacta las razones." },
  } as unknown as Question;
}

describe("SourceRefSchema — ai_field context_slugs", () => {
  it("accepts an ai_field with connected.context_slugs", () => {
    const parsed = SourceRefSchema.safeParse({
      source: "ai_field",
      source_ref: {
        connected: {
          kind: "document",
          slug: "decision-y-orden-del-juez-de-inmigracion",
          context_slugs: ["asilo-presentado-completo-con-anexos", "evidencias-sustentatorias"],
        },
        instruction: "Redacta.",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("still accepts an ai_field without context_slugs (regression)", () => {
    const parsed = SourceRefSchema.safeParse({
      source: "ai_field",
      source_ref: {
        connected: { kind: "document", slug: "decision-y-orden-del-juez-de-inmigracion" },
        instruction: "Redacta.",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects more than 5 context slugs (payload guardrail)", () => {
    const parsed = SourceRefSchema.safeParse({
      source: "ai_field",
      source_ref: {
        connected: {
          kind: "document",
          slug: "decision-y-orden-del-juez-de-inmigracion",
          context_slugs: ["a", "b", "c", "d", "e", "f"],
        },
        instruction: "Redacta.",
      },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("SourceRefSchema — value_map / default_value (ola apelación)", () => {
  it("accepts document_extraction with value_map + default_value", () => {
    const parsed = SourceRefSchema.safeParse({
      source: "document_extraction",
      source_ref: {
        document_slug: "decision-y-orden-del-juez-de-inmigracion",
        json_path: "is_oral_decision",
        value_map: { true: "oral", false: "written" },
        default_value: "oral",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts client_answer with a default_value (and still the plain null)", () => {
    expect(
      SourceRefSchema.safeParse({ source: "client_answer", source_ref: { default_value: "yes" } }).success,
    ).toBe(true);
    expect(SourceRefSchema.safeParse({ source: "client_answer", source_ref: null }).success).toBe(true);
  });
});

describe("GenerationSectionSchema — max_words cross-field check (ola apelación)", () => {
  const base = { key: "a1", heading: "A.1", min_words: 1000, max_tokens: 4000, guidance: "", type: "analysis" };

  it("accepts max_words 0 (legacy, no ceiling) and max_words >= min_words", () => {
    expect(GenerationSectionSchema.safeParse({ ...base, max_words: 0 }).success).toBe(true);
    expect(GenerationSectionSchema.safeParse({ ...base, max_words: 1400 }).success).toBe(true);
    expect(GenerationSectionSchema.safeParse(base).success).toBe(true); // absent → default 0
  });

  it("rejects a ceiling below the floor (self-contradictory prompt)", () => {
    const r = GenerationSectionSchema.safeParse({ ...base, max_words: 500 });
    expect(r.success).toBe(false);
  });
});

describe("validateSourceRef — value_map / default_value option checks", () => {
  const DOC_CTX: VersionCtx = {
    ...CTX,
    documentSlugsWithSchema: {
      "decision-y-orden-del-juez-de-inmigracion": {
        type: "object",
        properties: { is_oral_decision: { type: "boolean" } },
      },
    },
  };
  const selectOptions = [{ value: "oral" }, { value: "written" }];

  it("passes when every mapped value and the default are option values", () => {
    const issues = validateSourceRef(
      {
        source: "document_extraction",
        field_type: "select",
        options: selectOptions,
        source_ref: {
          document_slug: "decision-y-orden-del-juez-de-inmigracion",
          json_path: "is_oral_decision",
          value_map: { true: "oral", false: "written" },
          default_value: "oral",
        },
      } as unknown as Question,
      DOC_CTX,
    );
    expect(issues).toEqual([]);
  });

  it("blocks a value_map that maps to a non-option value on a select", () => {
    const issues = validateSourceRef(
      {
        source: "document_extraction",
        field_type: "select",
        options: selectOptions,
        source_ref: {
          document_slug: "decision-y-orden-del-juez-de-inmigracion",
          json_path: "is_oral_decision",
          value_map: { true: "hablada" },
        },
      } as unknown as Question,
      DOC_CTX,
    );
    expect(issues.some((i) => i.severity === "blocking" && i.detail.includes("hablada"))).toBe(true);
  });

  it("blocks a client_answer default_value outside the select options", () => {
    const issues = validateSourceRef(
      {
        source: "client_answer",
        field_type: "select",
        options: [{ value: "yes" }, { value: "no" }],
        source_ref: { default_value: "maybe" },
      } as unknown as Question,
      CTX,
    );
    expect(issues.some((i) => i.severity === "blocking" && i.detail.includes("maybe"))).toBe(true);
  });

  it("keeps plain client_answer (null source_ref) issue-free (regression)", () => {
    const issues = validateSourceRef(
      { source: "client_answer", source_ref: null } as unknown as Question,
      CTX,
    );
    expect(issues).toEqual([]);
  });
});

describe("validateSourceRef — ai_field context_slugs", () => {
  it("passes when every context slug is a requirement of the service", () => {
    const issues = validateSourceRef(
      aiFieldQuestion({
        kind: "document",
        slug: "decision-y-orden-del-juez-de-inmigracion",
        context_slugs: ["asilo-presentado-completo-con-anexos", "evidencias-sustentatorias"],
      }),
      CTX,
    );
    expect(issues).toEqual([]);
  });

  it("blocks when a context slug is not a requirement of the service", () => {
    const issues = validateSourceRef(
      aiFieldQuestion({
        kind: "document",
        slug: "decision-y-orden-del-juez-de-inmigracion",
        context_slugs: ["documento-inexistente"],
      }),
      CTX,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("blocking");
    expect(issues[0].detail).toContain("documento-inexistente");
  });

  it("blocks a context slug that repeats the primary document", () => {
    const issues = validateSourceRef(
      aiFieldQuestion({
        kind: "document",
        slug: "decision-y-orden-del-juez-de-inmigracion",
        context_slugs: ["decision-y-orden-del-juez-de-inmigracion"],
      }),
      CTX,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("blocking");
  });

  it("blocks context_slugs on an ai_letter connection (documents only)", () => {
    const issues = validateSourceRef(
      aiFieldQuestion({ kind: "ai_letter", slug: "carta", context_slugs: ["evidencias-sustentatorias"] }),
      CTX,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("blocking");
  });
});
