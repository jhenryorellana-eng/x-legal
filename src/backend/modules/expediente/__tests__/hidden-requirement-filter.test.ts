/**
 * expediente/repository — listApprovedDocumentsForMaterial hides documents whose
 * requirement was hidden for the case (case_requirement_overrides.is_hidden=true).
 *
 * A hidden requirement's approved document must NOT reach the expediente (no cover,
 * no item). This is the single source of "material", so both auto-assembly and
 * Diana's manual picker inherit the filter. Per-party overrides only hide that party.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  docs: [] as unknown[],
  hidden: [] as unknown[],
  hiddenError: null as { message: string } | null,
}));

const mocks = vi.hoisted(() => {
  const from = vi.fn((table: string) => {
    if (table === "case_documents") {
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: state.docs }) }) }),
        }),
      };
    }
    if (table === "case_requirement_overrides") {
      return {
        select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: state.hidden, error: state.hiddenError }) }) }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from };
});

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(() => ({ from: mocks.from })),
}));

// The repository dynamically imports the catalog barrel (which statically loads
// service→anthropic→env). Mock it to expose the REAL pure predicate from domain,
// so the test exercises the actual match rule without booting the env schema.
vi.mock("@/backend/modules/catalog", async () => {
  const domain = await vi.importActual<typeof import("@/backend/modules/catalog/domain")>(
    "@/backend/modules/catalog/domain",
  );
  return { isRequirementHiddenFor: domain.isRequirementHiddenFor };
});

import { listApprovedDocumentsForMaterial } from "../repository";

const doc = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "cd-1",
  required_document_type_id: "doc-1",
  storage_path: "case-documents/x.pdf",
  original_filename: "x.pdf",
  display_name: null,
  party_id: null,
  created_at: "2026-07-20T00:00:00Z",
  required_document_types: { label_i18n: { es: "Recibo", en: "Receipt" } },
  ...over,
});

beforeEach(() => {
  state.docs = [];
  state.hidden = [];
  state.hiddenError = null;
  vi.clearAllMocks();
});

describe("listApprovedDocumentsForMaterial — hidden requirement filter", () => {
  it("excludes a document whose requirement is hidden case-wide", async () => {
    state.docs = [doc({ id: "cd-1", required_document_type_id: "doc-1" })];
    state.hidden = [{ required_document_type_id: "doc-1", party_id: null }];
    const rows = await listApprovedDocumentsForMaterial("case-1");
    expect(rows).toHaveLength(0);
  });

  it("keeps a document when the per-party hide targets a DIFFERENT party", async () => {
    state.docs = [doc({ id: "cd-1", required_document_type_id: "doc-1", party_id: "p1" })];
    state.hidden = [{ required_document_type_id: "doc-1", party_id: "p2" }];
    const rows = await listApprovedDocumentsForMaterial("case-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].refId).toBe("cd-1");
  });

  it("excludes when the per-party hide targets the SAME party", async () => {
    state.docs = [doc({ id: "cd-1", required_document_type_id: "doc-1", party_id: "p1" })];
    state.hidden = [{ required_document_type_id: "doc-1", party_id: "p1" }];
    const rows = await listApprovedDocumentsForMaterial("case-1");
    expect(rows).toHaveLength(0);
  });

  it("never excludes a free-uploaded document (no requirement FK)", async () => {
    state.docs = [doc({ id: "cd-9", required_document_type_id: null, required_document_types: null })];
    state.hidden = [{ required_document_type_id: "doc-1", party_id: null }];
    const rows = await listApprovedDocumentsForMaterial("case-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].requirementLabel).toBeNull();
  });

  it("keeps everything when there are no hidden overrides", async () => {
    state.docs = [
      doc({ id: "cd-1", required_document_type_id: "doc-1" }),
      doc({ id: "cd-2", required_document_type_id: "doc-2" }),
    ];
    state.hidden = [];
    const rows = await listApprovedDocumentsForMaterial("case-1");
    expect(rows.map((r) => r.refId)).toEqual(["cd-1", "cd-2"]);
  });

  it("fails CLOSED (throws) if the overrides read errors — never leaks under uncertainty", async () => {
    state.docs = [doc({ id: "cd-1", required_document_type_id: "doc-1" })];
    state.hiddenError = { message: "connection reset" };
    await expect(listApprovedDocumentsForMaterial("case-1")).rejects.toThrow(/case_requirement_overrides/);
  });
});
