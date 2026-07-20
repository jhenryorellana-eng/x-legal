/**
 * ai-engine repository — resolveGenerationInputs multi-document resolution.
 *
 * An allow_multiple requirement (e.g. evidencias-sustentatorias) uploads N
 * coexisting case_documents under the same slug. Generation, questionnaire and
 * Pre-Mortem context must receive EVERY active document — the old `.limit(1)`
 * silently dropped all but one evidence.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  /** FIFO of results per table; each awaited chain consumes one. */
  const queues = new Map<string, Array<{ data: unknown }>>();
  const orderCalls: Array<{ table: string; column: string; opts: unknown }> = [];

  function nextResult(table: string): { data: unknown } {
    return (queues.get(table) ?? []).shift() ?? { data: [] };
  }

  const from = vi.fn((table: string) => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    for (const m of ["select", "eq", "in", "is", "not", "limit"]) {
      c[m] = vi.fn(self);
    }
    c.order = vi.fn((column: string, opts: unknown) => {
      orderCalls.push({ table, column, opts });
      return c;
    });
    c.maybeSingle = vi.fn(async () => nextResult(table));
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(nextResult(table)).then(res, rej);
    return c;
  });

  return { from, queues, orderCalls };
});

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(() => ({ from: mocks.from })),
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/backend/platform/embeddings", () => ({
  toVectorLiteral: vi.fn(() => "[]"),
}));

import { resolveGenerationInputs, loadResolvedInputs } from "../repository";
import { logger } from "@/backend/platform/logger";
import type { ConfigSnapshot } from "../domain";

const CASE_ID = "case-1";
const EVIDENCE_SLUG = "evidencias-sustentatorias";

function docRow(id: string, slug = EVIDENCE_SLUG) {
  return { id, required_document_types: { slug } };
}
function extResult(id: string) {
  return { data: [{ id }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queues.clear();
  mocks.orderCalls.length = 0;
});

describe("resolveGenerationInputs — multi-document slugs", () => {
  it("resolves EVERY active document of an allow_multiple slug, in upload order", async () => {
    mocks.queues.set("case_documents", [
      { data: [docRow("doc-1"), docRow("doc-2"), docRow("doc-3")] },
    ]);
    mocks.queues.set("document_extractions", [
      extResult("ext-1"),
      extResult("ext-2"),
      extResult("ext-3"),
    ]);

    const resolved = await resolveGenerationInputs(CASE_ID, null, [], [EVIDENCE_SLUG]);

    expect(resolved.documents).toEqual([
      { slug: EVIDENCE_SLUG, case_document_id: "doc-1", extraction_id: "ext-1" },
      { slug: EVIDENCE_SLUG, case_document_id: "doc-2", extraction_id: "ext-2" },
      { slug: EVIDENCE_SLUG, case_document_id: "doc-3", extraction_id: "ext-3" },
    ]);
  });

  it("asks the DB for chronological order (created_at ascending)", async () => {
    mocks.queues.set("case_documents", [{ data: [docRow("doc-1")] }]);
    mocks.queues.set("document_extractions", [extResult("ext-1")]);

    await resolveGenerationInputs(CASE_ID, null, [], [EVIDENCE_SLUG]);

    const order = mocks.orderCalls.find((c) => c.table === "case_documents");
    expect(order?.column).toBe("created_at");
    expect(order?.opts).toEqual({ ascending: true });
  });

  it("skips a document without completed extraction, keeping the rest", async () => {
    mocks.queues.set("case_documents", [{ data: [docRow("doc-1"), docRow("doc-2")] }]);
    mocks.queues.set("document_extractions", [{ data: [] }, extResult("ext-2")]);

    const resolved = await resolveGenerationInputs(CASE_ID, null, [], [EVIDENCE_SLUG]);

    expect(resolved.documents).toEqual([
      { slug: EVIDENCE_SLUG, case_document_id: "doc-2", extraction_id: "ext-2" },
    ]);
  });

  it("caps a runaway slug at the newest 10 documents and warns", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => docRow(`doc-${i + 1}`));
    mocks.queues.set("case_documents", [{ data: rows }]);
    mocks.queues.set(
      "document_extractions",
      Array.from({ length: 10 }, (_, i) => extResult(`ext-${i + 3}`)),
    );

    const resolved = await resolveGenerationInputs(CASE_ID, null, [], [EVIDENCE_SLUG]);

    expect(resolved.documents).toHaveLength(10);
    // The 2 OLDEST are dropped; upload order preserved among the kept.
    expect(resolved.documents[0]).toEqual({
      slug: EVIDENCE_SLUG,
      case_document_id: "doc-3",
      extraction_id: "ext-3",
    });
    expect(resolved.documents[9].case_document_id).toBe("doc-12");
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });

  it("still resolves a single-slot slug to exactly one entry (regression)", async () => {
    mocks.queues.set("case_documents", [{ data: [docRow("doc-1", "decision")] }]);
    mocks.queues.set("document_extractions", [extResult("ext-1")]);

    const resolved = await resolveGenerationInputs(CASE_ID, null, [], ["decision"]);

    expect(resolved.documents).toEqual([
      { slug: "decision", case_document_id: "doc-1", extraction_id: "ext-1" },
    ]);
  });
});

function snapshotWith(
  docs: Array<{ slug: string; case_document_id: string; extraction_id: string }>,
): ConfigSnapshot {
  return { resolved_inputs: { documents: docs, forms: [] } } as unknown as ConfigSnapshot;
}

describe("loadResolvedInputs — document labels", () => {
  it("loads the file label from case_documents.display_name", async () => {
    mocks.queues.set("document_extractions", [
      { data: { payload: { a: 1 }, raw_text: "texto" } },
    ]);
    mocks.queues.set("case_documents", [
      { data: { display_name: "Denuncia policial.pdf", original_filename: "scan1.pdf" } },
    ]);

    const loaded = await loadResolvedInputs(
      snapshotWith([{ slug: EVIDENCE_SLUG, case_document_id: "doc-1", extraction_id: "ext-1" }]),
    );

    expect(loaded.documents).toEqual([
      {
        slug: EVIDENCE_SLUG,
        extractionPayload: { a: 1 },
        rawText: "texto",
        label: "Denuncia policial.pdf",
      },
    ]);
  });

  it("falls back to original_filename when display_name is null", async () => {
    mocks.queues.set("document_extractions", [
      { data: { payload: {}, raw_text: "" } },
    ]);
    mocks.queues.set("case_documents", [
      { data: { display_name: null, original_filename: "scan1.pdf" } },
    ]);

    const loaded = await loadResolvedInputs(
      snapshotWith([{ slug: EVIDENCE_SLUG, case_document_id: "doc-1", extraction_id: "ext-1" }]),
    );

    expect(loaded.documents[0].label).toBe("scan1.pdf");
  });

  it("omits the label when the document row is gone (never throws)", async () => {
    mocks.queues.set("document_extractions", [
      { data: { payload: {}, raw_text: "t" } },
    ]);
    mocks.queues.set("case_documents", [{ data: null }]);

    const loaded = await loadResolvedInputs(
      snapshotWith([{ slug: EVIDENCE_SLUG, case_document_id: "doc-1", extraction_id: "ext-1" }]),
    );

    expect(loaded.documents).toHaveLength(1);
    expect(loaded.documents[0].label).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Wave 1 regression — what the DRAFTING PROMPT is allowed to see
// ---------------------------------------------------------------------------

describe("loadResolvedInputs — form answers filtered by provenance", () => {
  function formSnapshot(): ConfigSnapshot {
    return {
      resolved_inputs: { documents: [], forms: [{ slug: "cuestionario", response_id: "resp-1" }] },
    } as unknown as ConfigSnapshot;
  }

  /** Queues the two reads loadResolvedInputs makes per form: the answers row, then
   *  the labels row (loadQuestionLabelsForResponse). No automation version → the
   *  answers stay keyed by question id, which keeps the assertions readable. */
  function queueForm(answers: unknown, answerProvenance: unknown) {
    mocks.queues.set("case_form_responses", [
      { data: { answers, answer_provenance: answerProvenance } },
      { data: null },
    ]);
    mocks.queues.set("form_automation_versions", [{ data: null }]);
  }

  it("drops ai_gap_filled answers into declaredGaps instead of the prompt", async () => {
    // The exact failure being fixed: a fabricated first-person sentence reaching
    // the drafting model as if the client had testified to it.
    queueForm(
      { good: "Testimonio real.", filler: "Por ahora no cuento con información." },
      { good: "ai_grounded", filler: "ai_gap_filled" },
    );

    const loaded = await loadResolvedInputs(formSnapshot());

    expect(loaded.forms[0].answers).toEqual({ good: "Testimonio real." });
    expect(loaded.forms[0].declaredGaps).toEqual(["filler"]);
  });

  it("KEEPS answers of unknown provenance — deliberately laxer than the gate", async () => {
    // Migration 0095 backfilled every pre-existing answer to 'unknown', including
    // genuinely grounded ones. The gate blocks on those (a review is cheap and
    // reversible); the prompt must NOT drop them, because that would delete real
    // client testimony over a migration artifact.
    queueForm({ legacy: "Respuesta real de un caso antiguo." }, { legacy: "unknown" });

    const loaded = await loadResolvedInputs(formSnapshot());

    expect(loaded.forms[0].answers).toEqual({ legacy: "Respuesta real de un caso antiguo." });
    expect(loaded.forms[0].declaredGaps).toEqual([]);
  });

  it("keeps answers with no provenance column at all (pre-0095 rows)", async () => {
    queueForm({ a: "x" }, null);

    const loaded = await loadResolvedInputs(formSnapshot());

    expect(loaded.forms[0].answers).toEqual({ a: "x" });
    expect(loaded.forms[0].declaredGaps).toEqual([]);
  });
});
