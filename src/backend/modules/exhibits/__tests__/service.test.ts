import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks (hoisted handles) ------------------------------------------------
const h = vi.hoisted(() => ({
  getRunForCapture: vi.fn(),
  getAttachConfig: vi.fn(),
  getDatasetUrlItems: vi.fn(),
  getCaseOrgId: vi.fn(),
  insertExhibits: vi.fn(),
  listPendingByRun: vi.fn(),
  claimExhibit: vi.fn(),
  markReady: vi.fn(),
  markFailed: vi.fn(),
  countUnsettledByRun: vi.fn(),
  listByRun: vi.fn(),
  getExhibitById: vi.fn(),
  resetToPending: vi.fn(),
  listReadyByCase: vi.fn(),
  findReusableByUrlHash: vi.fn(),
  isCircuitOpen: vi.fn(),
  recordDomainSuccess: vi.fn(),
  recordDomainFailure: vi.fn(),
  enqueueJob: vi.fn(),
  uploadBytesToStorage: vi.fn(),
  downloadBytesFromStorage: vi.fn(),
  countPdfPages: vi.fn(),
  render: vi.fn(),
  safeFetch: vi.fn(),
  emitExhibitsRunSettled: vi.fn(),
}));

vi.mock("../repository", () => ({
  getRunForCapture: h.getRunForCapture,
  getAttachConfig: h.getAttachConfig,
  getDatasetUrlItems: h.getDatasetUrlItems,
  getCaseOrgId: h.getCaseOrgId,
  insertExhibits: h.insertExhibits,
  listPendingByRun: h.listPendingByRun,
  claimExhibit: h.claimExhibit,
  markReady: h.markReady,
  markFailed: h.markFailed,
  countUnsettledByRun: h.countUnsettledByRun,
  listByRun: h.listByRun,
  getExhibitById: h.getExhibitById,
  resetToPending: h.resetToPending,
  listReadyByCase: h.listReadyByCase,
  findReusableByUrlHash: h.findReusableByUrlHash,
  isCircuitOpen: h.isCircuitOpen,
  recordDomainSuccess: h.recordDomainSuccess,
  recordDomainFailure: h.recordDomainFailure,
}));
vi.mock("@/backend/platform/authz", () => ({ can: vi.fn() }));
vi.mock("@/backend/platform/qstash", () => ({ enqueueJob: h.enqueueJob }));
vi.mock("@/backend/platform/storage", () => ({
  uploadBytesToStorage: h.uploadBytesToStorage,
  downloadBytesFromStorage: h.downloadBytesFromStorage,
}));
vi.mock("@/backend/platform/pdf", () => ({ countPdfPages: h.countPdfPages }));
vi.mock("@/backend/platform/renderer", () => ({ getRenderer: () => ({ render: h.render }) }));
vi.mock("@/backend/platform/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../events", () => ({ emitExhibitsRunSettled: h.emitExhibitsRunSettled }));

// safe-fetch + ssrf keep their real error classes; only safeFetch is stubbed.
vi.mock("@/backend/platform/safe-fetch", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, safeFetch: h.safeFetch };
});

import { captureFromRun, executeFetchExhibitJob } from "../service";

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
function pdfResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/pdf" },
    arrayBuffer: async () => pdfBytes.buffer.slice(0),
    body: { cancel: async () => {} },
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("captureFromRun", () => {
  it("skips when the letter has attach_sources disabled", async () => {
    h.getRunForCapture.mockResolvedValue({ id: "run1", caseId: "case1", formDefinitionId: "form1", configSnapshot: {} });
    h.getAttachConfig.mockResolvedValue({ enabled: false, kinds: [], curatedSources: [], datasetId: null });
    const r = await captureFromRun({ runId: "run1" });
    expect(r.skipped).toBe(true);
    expect(h.insertExhibits).not.toHaveBeenCalled();
    expect(h.enqueueJob).not.toHaveBeenCalled();
  });

  it("captures country + jurisprudence sources, dedups, and fans out one job per pending exhibit", async () => {
    h.getRunForCapture.mockResolvedValue({
      id: "run1",
      caseId: "case1",
      formDefinitionId: "form1",
      configSnapshot: {
        research: {
          jurisprudence: [{ name: "Flores v. Reno", court: "SCOTUS", year: "1993", factual_analogy: "x", url: "https://courtlistener.com/o/123" }],
          country_conditions: [
            { source_name: "HRW", author: "HRW", why_it_helps: "pattern", published_date: "2024", url: "https://hrw.org/ve?utm_source=x" },
            { source_name: "HRW dup", url: "https://www.hrw.org/ve" }, // same canonical → deduped
          ],
        },
      },
    });
    h.getAttachConfig.mockResolvedValue({
      enabled: true,
      kinds: ["country_condition", "jurisprudence"],
      curatedSources: [],
      datasetId: null,
    });
    h.insertExhibits.mockResolvedValue(2);
    h.getCaseOrgId.mockResolvedValue("org1");
    h.listPendingByRun.mockResolvedValue([
      { id: "ex1", case_id: "case1" },
      { id: "ex2", case_id: "case1" },
    ]);

    const r = await captureFromRun({ runId: "run1" });

    // dedup: 3 raw sources (1 jurisprudence + 2 country, 2 of which collapse) → 2 selected
    const inserted = h.insertExhibits.mock.calls[0][0];
    expect(inserted).toHaveLength(2);
    expect(r.captured).toBe(2);
    expect(h.enqueueJob).toHaveBeenCalledTimes(2);
    expect(h.enqueueJob.mock.calls[0][0]).toMatchObject({ jobKey: "fetch-exhibit", exhibitId: "ex1", orgId: "org1" });
  });
});

describe("executeFetchExhibitJob", () => {
  it("is a no-op (skipped) when the exhibit was already claimed/terminal", async () => {
    h.claimExhibit.mockResolvedValue(null);
    expect(await executeFetchExhibitJob({ exhibitId: "ex1" })).toBe("skipped");
    expect(h.uploadBytesToStorage).not.toHaveBeenCalled();
  });

  it("downloads a direct PDF, stores it, marks ready, and settles the run when none remain", async () => {
    h.claimExhibit.mockResolvedValue({
      id: "ex1",
      case_id: "case1",
      run_id: "run1",
      url_hash: "abc",
      canonical_url: "https://state.gov/report.pdf",
      attempts: 1,
    });
    h.findReusableByUrlHash.mockResolvedValue(null);
    h.isCircuitOpen.mockResolvedValue(false);
    h.getCaseOrgId.mockResolvedValue("org1");
    h.safeFetch.mockResolvedValue(pdfResponse());
    h.countPdfPages.mockResolvedValue(3);
    h.countUnsettledByRun.mockResolvedValue(0);
    h.listByRun.mockResolvedValue([{ status: "ready" }, { status: "failed" }]);

    const out = await executeFetchExhibitJob({ exhibitId: "ex1" });

    expect(out).toBe("completed");
    expect(h.uploadBytesToStorage).toHaveBeenCalledWith(
      "expedientes",
      "exhibits/case1/abc.pdf",
      expect.any(Uint8Array),
      "application/pdf",
    );
    expect(h.markReady).toHaveBeenCalledWith("ex1", expect.objectContaining({ fetchMethod: "pdf", pageCount: 3 }));
    expect(h.recordDomainSuccess).toHaveBeenCalledWith("state.gov");
    expect(h.emitExhibitsRunSettled).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run1", ready: 1, failed: 1 }),
    );
  });

  it("reuses a cached copy (same canonical URL on another case) without fetching", async () => {
    h.claimExhibit.mockResolvedValue({
      id: "ex2",
      case_id: "case2",
      run_id: "run2",
      url_hash: "abc",
      canonical_url: "https://state.gov/report.pdf",
      attempts: 1,
    });
    h.findReusableByUrlHash.mockResolvedValue({
      id: "ex1",
      pdf_path: "exhibits/case1/abc.pdf",
      content_sha256: "sha-1",
      page_count: 9,
      fetch_method: "render",
      final_url: "https://state.gov/report.pdf",
    });
    h.downloadBytesFromStorage.mockResolvedValue(pdfBytes);
    h.getCaseOrgId.mockResolvedValue("org1");
    h.countUnsettledByRun.mockResolvedValue(0);
    h.listByRun.mockResolvedValue([{ status: "ready" }]);

    const out = await executeFetchExhibitJob({ exhibitId: "ex2" });

    expect(out).toBe("completed");
    expect(h.safeFetch).not.toHaveBeenCalled(); // no network fetch — pure cache reuse
    expect(h.downloadBytesFromStorage).toHaveBeenCalledWith("expedientes", "exhibits/case1/abc.pdf");
    expect(h.markReady).toHaveBeenCalledWith(
      "ex2",
      expect.objectContaining({ pdfPath: "exhibits/case2/abc.pdf", fetchMethod: "render", pageCount: 9 }),
    );
  });
});
