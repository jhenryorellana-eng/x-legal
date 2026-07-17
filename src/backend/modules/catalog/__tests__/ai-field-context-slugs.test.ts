/**
 * Catalog domain — ai_field `connected.context_slugs` (multi-document interpreter).
 *
 * Ola Apelación: an ai_field (kind: document) may attach ADDITIONAL requirement
 * documents as context (e.g. EOIR-26 item #6 reads the judge's decision PLUS the
 * asylum package and new evidence). The schema must accept the optional list and
 * publication validation must verify every context slug is a real requirement.
 */

import { describe, it, expect } from "vitest";

import { SourceRefSchema, validateSourceRef, type Question, type VersionCtx } from "../domain";

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
