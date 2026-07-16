/**
 * Cases repository — listDocumentExtractionsForCase embed shape.
 *
 * Regression: document_extractions is 1:1 with case_documents (UNIQUE on
 * case_document_id), so PostgREST embeds it as an OBJECT. The old mapping only
 * accepted an array (`Array.isArray(ext) ? ext[0] : null`), so every extraction
 * payload reached callers as null — the Pre-Mortem case context reported
 * "extractions are null" even though the fill pipeline (which queries
 * document_extractions directly) saw them fine.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const neq = vi.fn();
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ neq })),
    })),
  }));
  return { from, neq };
});

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(() => ({ from: mocks.from })),
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { listDocumentExtractionsForCase } from "../repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listDocumentExtractionsForCase", () => {
  it("maps the 1:1 OBJECT embed PostgREST returns for document_extractions", async () => {
    mocks.neq.mockResolvedValue({
      data: [
        {
          id: "doc-1",
          status: "uploaded",
          party_id: null,
          required_document_types: { slug: "decision-y-orden-del-juez-de-inmigracion" },
          // 1:1 relationship → object, NOT array
          document_extractions: { status: "completed", payload: { decision_date: "2026-07-02" } },
        },
      ],
    });

    const rows = await listDocumentExtractionsForCase("case-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].extractionStatus).toBe("completed");
    expect(rows[0].extractionPayload).toEqual({ decision_date: "2026-07-02" });
  });

  it("still accepts the array shape (defensive) and missing extractions", async () => {
    mocks.neq.mockResolvedValue({
      data: [
        {
          id: "doc-2",
          status: "uploaded",
          party_id: null,
          required_document_types: { slug: "pasaporte-del-apelante" },
          document_extractions: [{ status: "completed", payload: { full_name: "X" } }],
        },
        {
          id: "doc-3",
          status: "uploaded",
          party_id: null,
          required_document_types: { slug: "asilo-presentado-completo-con-anexos" },
          document_extractions: null,
        },
      ],
    });

    const rows = await listDocumentExtractionsForCase("case-1");
    expect(rows[0].extractionPayload).toEqual({ full_name: "X" });
    expect(rows[1].extractionStatus).toBeNull();
    expect(rows[1].extractionPayload).toBeNull();
  });
});
