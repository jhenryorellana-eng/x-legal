/**
 * evaluations module — service unit tests.
 *
 * Covers: HMAC verification, consume idempotency + races, webhook completed
 * happy-path (PDF pipeline mocked at platform boundaries), failed→refund
 * exactly-once, webhook-before-consume, grant authz, api-key check.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockFindEvaluationByCase,
  mockFindEvaluationByToken,
  mockFindEvaluationById,
  mockInsertEvaluation,
  mockUpdateEvaluation,
  mockCasAttemptsUsed,
  mockSetAttemptsUsed,
  mockFindRunByJobId,
  mockInsertRun,
  mockTransitionRun,
  mockListRunsForEvaluation,
  mockFindCaseBasic,
  mockFindClientInfoForCase,
  mockListStaleInProgress,
} = vi.hoisted(() => ({
  mockFindEvaluationByCase: vi.fn(),
  mockFindEvaluationByToken: vi.fn(),
  mockFindEvaluationById: vi.fn(),
  mockInsertEvaluation: vi.fn(),
  mockUpdateEvaluation: vi.fn(),
  mockCasAttemptsUsed: vi.fn(),
  mockSetAttemptsUsed: vi.fn(),
  mockFindRunByJobId: vi.fn(),
  mockInsertRun: vi.fn(),
  mockTransitionRun: vi.fn(),
  mockListRunsForEvaluation: vi.fn(),
  mockFindCaseBasic: vi.fn(),
  mockFindClientInfoForCase: vi.fn(),
  mockListStaleInProgress: vi.fn(),
}));

const { mockClaimWebhookEvent, mockMarkWebhookEventProcessed } = vi.hoisted(() => ({
  mockClaimWebhookEvent: vi.fn(),
  mockMarkWebhookEventProcessed: vi.fn(),
}));

const { mockWriteAudit, mockAppendCaseTimeline } = vi.hoisted(() => ({
  mockWriteAudit: vi.fn(),
  mockAppendCaseTimeline: vi.fn(),
}));

const { mockGetExternalTool } = vi.hoisted(() => ({ mockGetExternalTool: vi.fn() }));

const { mockCan, mockRequireCaseAccess } = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockRequireCaseAccess: vi.fn(),
}));

const { mockSafeFetch } = vi.hoisted(() => ({ mockSafeFetch: vi.fn() }));

const {
  mockUploadBytesToStorage,
  mockCreateSignedDownloadUrl,
  mockValidateMagicBytes,
} = vi.hoisted(() => ({
  mockUploadBytesToStorage: vi.fn(),
  mockCreateSignedDownloadUrl: vi.fn(),
  mockValidateMagicBytes: vi.fn(),
}));

const { mockEmitCompleted, mockEmitFailed } = vi.hoisted(() => ({
  mockEmitCompleted: vi.fn(),
  mockEmitFailed: vi.fn(),
}));

const WEBHOOK_SECRET = "test-webhook-secret-32bytes-long!!";

const { mockProviderEnv } = vi.hoisted(() => ({
  mockProviderEnv: vi.fn().mockReturnValue({
    JUEZ_API_KEY: "test-api-key-secret",
    JUEZ_WEBHOOK_SECRET: "test-webhook-secret-32bytes-long!!",
  }),
}));

// ---------------------------------------------------------------------------
// vi.mock declarations
// ---------------------------------------------------------------------------

vi.mock("../repository", () => ({
  findEvaluationByCase: mockFindEvaluationByCase,
  findEvaluationByToken: mockFindEvaluationByToken,
  findEvaluationById: mockFindEvaluationById,
  insertEvaluation: mockInsertEvaluation,
  updateEvaluation: mockUpdateEvaluation,
  casAttemptsUsed: mockCasAttemptsUsed,
  setAttemptsUsed: mockSetAttemptsUsed,
  findRunByJobId: mockFindRunByJobId,
  insertRun: mockInsertRun,
  transitionRun: mockTransitionRun,
  listRunsForEvaluation: mockListRunsForEvaluation,
  findCaseBasic: mockFindCaseBasic,
  findClientInfoForCase: mockFindClientInfoForCase,
  listStaleInProgress: mockListStaleInProgress,
}));

vi.mock("@/backend/platform/ssrf", () => ({
  assertPublicUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/backend/platform/webhook-events", () => ({
  claimWebhookEvent: mockClaimWebhookEvent,
  markWebhookEventProcessed: mockMarkWebhookEventProcessed,
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mockWriteAudit,
  appendCaseTimeline: mockAppendCaseTimeline,
}));

vi.mock("@/backend/modules/catalog", () => ({
  getExternalTool: mockGetExternalTool,
}));

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  requireCaseAccess: mockRequireCaseAccess,
  AuthzError: class AuthzError extends Error {
    constructor(public reason: string) {
      super(reason);
      this.name = "AuthzError";
    }
  },
}));

vi.mock("@/backend/platform/env", () => ({
  providerEnv: mockProviderEnv,
}));

vi.mock("@/backend/platform/safe-fetch", () => ({
  safeFetch: mockSafeFetch,
}));

vi.mock("@/backend/platform/storage", () => ({
  uploadBytesToStorage: mockUploadBytesToStorage,
  createSignedDownloadUrl: mockCreateSignedDownloadUrl,
  validateMagicBytes: mockValidateMagicBytes,
}));

vi.mock("../events", () => ({
  emitEvaluationCompleted: mockEmitCompleted,
  emitEvaluationFailed: mockEmitFailed,
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import {
  consumeAttempt,
  processJuezWebhook,
  grantExtraAttempt,
  verifyJuezApiKey,
  getSessionForJuez,
} from "../service";
import type { Actor } from "@/backend/platform/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOKEN = "3f2b8c04-1111-4222-8333-944445555666";
const JOB_ID = "11111111-2222-4333-8444-555566667777";
const PDF_URL = "https://abc.public.blob.vercel-storage.com/xlegal/informes/i.pdf";

const caseCols = {
  id: "case-1",
  org_id: "org-1",
  service_id: "svc-1",
  status: "active",
  primary_client_id: "client-1",
  case_number: "ULP-2026-0999",
};

function evalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "eval-1",
    org_id: "org-1",
    case_id: "case-1",
    tool_key: "juez",
    access_token: TOKEN,
    attempts_allowed: 1,
    attempts_used: 0,
    status: "pending",
    last_job_id: null,
    pdf_storage_path: null,
    report_meta: {},
    delivered_at: null,
    created_at: "2026-07-23T00:00:00Z",
    updated_at: "2026-07-23T00:00:00Z",
    case: caseCols,
    ...overrides,
  };
}

function sign(raw: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
}

function completedPayload(overrides: Record<string, unknown> = {}) {
  return {
    event: "evaluation.completed",
    token: TOKEN,
    jobId: JOB_ID,
    completedAt: "2026-07-23T18:30:00.000Z",
    result: { pdfUrl: PDF_URL, score: 62, nivel: "moderado", headline: "Caso sólido" },
    ...overrides,
  };
}

function pdfResponse(bytes: Buffer = Buffer.from("%PDF-1.7 fake")) {
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k === "content-length" ? String(bytes.length) : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  } as unknown as Response;
}

const adminActor: Actor = {
  userId: "staff-1",
  orgId: "org-1",
  kind: "staff",
  role: "admin",
  permissions: new Map(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockClaimWebhookEvent.mockResolvedValue("fresh");
  mockValidateMagicBytes.mockReturnValue({ ok: true });
  mockCreateSignedDownloadUrl.mockResolvedValue("https://signed.example/x.pdf");
  mockUploadBytesToStorage.mockResolvedValue("evaluations/case-1/j.pdf");
  mockRequireCaseAccess.mockResolvedValue(undefined);
  mockListRunsForEvaluation.mockResolvedValue([]);
  mockSetAttemptsUsed.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// verifyJuezApiKey
// ---------------------------------------------------------------------------

describe("verifyJuezApiKey", () => {
  it("accepts the exact key, rejects wrong/missing", () => {
    expect(verifyJuezApiKey("test-api-key-secret")).toBe(true);
    expect(verifyJuezApiKey("wrong-key")).toBe(false);
    expect(verifyJuezApiKey(null)).toBe(false);
  });

  it("rejects when the provider env is not configured", () => {
    mockProviderEnv.mockImplementationOnce(() => {
      throw new Error("not configured");
    });
    expect(verifyJuezApiKey("test-api-key-secret")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// consumeAttempt
// ---------------------------------------------------------------------------

describe("consumeAttempt", () => {
  it("returns null for an unknown token", async () => {
    mockFindEvaluationByToken.mockResolvedValue(null);
    expect(await consumeAttempt(TOKEN, JOB_ID)).toBeNull();
  });

  it("is idempotent per jobId (existing run → already_consumed, no counter change)", async () => {
    mockFindEvaluationByToken.mockResolvedValue(evalRow({ attempts_used: 1, status: "in_progress" }));
    mockFindRunByJobId.mockResolvedValue({ id: "run-1", status: "consumed" });

    const res = await consumeAttempt(TOKEN, JOB_ID);
    expect(res).toEqual({ outcome: "already_consumed", attemptsAllowed: 1, attemptsUsed: 1 });
    expect(mockCasAttemptsUsed).not.toHaveBeenCalled();
    expect(mockInsertRun).not.toHaveBeenCalled();
  });

  it("returns no_attempts when the counter is full", async () => {
    mockFindEvaluationByToken.mockResolvedValue(evalRow({ attempts_used: 1 }));
    mockFindRunByJobId.mockResolvedValue(null);

    const res = await consumeAttempt(TOKEN, "22222222-3333-4444-8555-666677778888");
    expect(res).toEqual({ outcome: "no_attempts" });
    expect(mockInsertRun).not.toHaveBeenCalled();
  });

  it("happy path: CAS increment + run insert + in_progress", async () => {
    mockFindEvaluationByToken.mockResolvedValue(evalRow());
    mockFindRunByJobId.mockResolvedValue(null);
    mockCasAttemptsUsed.mockResolvedValue(true);
    mockInsertRun.mockResolvedValue({ row: { id: "run-1" }, conflict: false });

    const res = await consumeAttempt(TOKEN, JOB_ID);
    expect(res).toEqual({ outcome: "consumed", attemptsAllowed: 1, attemptsUsed: 1 });
    expect(mockCasAttemptsUsed).toHaveBeenCalledWith("eval-1", 0, 1);
    expect(mockInsertRun).toHaveBeenCalledWith(
      expect.objectContaining({ evaluation_id: "eval-1", job_id: JOB_ID, status: "consumed" }),
    );
    expect(mockUpdateEvaluation).toHaveBeenCalledWith(
      "eval-1",
      expect.objectContaining({ status: "in_progress", last_job_id: JOB_ID }),
    );
  });

  it("same-jobId race: run insert conflicts → refunds the increment → already_consumed", async () => {
    mockFindEvaluationByToken.mockResolvedValue(evalRow());
    mockFindRunByJobId.mockResolvedValue(null);
    mockCasAttemptsUsed.mockResolvedValue(true);
    mockInsertRun.mockResolvedValue({ row: null, conflict: true });

    const res = await consumeAttempt(TOKEN, JOB_ID);
    expect(res).toEqual({ outcome: "already_consumed", attemptsAllowed: 1, attemptsUsed: 0 });
    // refund: CAS back down from used+1
    expect(mockCasAttemptsUsed).toHaveBeenLastCalledWith("eval-1", 1, -1);
  });
});

// ---------------------------------------------------------------------------
// processJuezWebhook — signature layer
// ---------------------------------------------------------------------------

describe("processJuezWebhook — signature", () => {
  it("throws WEBHOOK_SIGNATURE_MISSING without a signature", async () => {
    await expect(processJuezWebhook("{}", null)).rejects.toMatchObject({
      code: "WEBHOOK_SIGNATURE_MISSING",
    });
  });

  it("throws WEBHOOK_SIGNATURE_INVALID on a wrong signature", async () => {
    await expect(processJuezWebhook("{}", "deadbeef")).rejects.toMatchObject({
      code: "WEBHOOK_SIGNATURE_INVALID",
    });
  });

  it("no-ops (resolves) on a signed but malformed payload", async () => {
    const raw = JSON.stringify({ hello: "world" });
    await expect(processJuezWebhook(raw, sign(raw))).resolves.toBeUndefined();
    expect(mockFindEvaluationByToken).not.toHaveBeenCalled();
  });

  it("no-ops on a signed payload for an unknown token", async () => {
    mockFindEvaluationByToken.mockResolvedValue(null);
    const raw = JSON.stringify(completedPayload());
    await expect(processJuezWebhook(raw, sign(raw))).resolves.toBeUndefined();
    expect(mockClaimWebhookEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// evaluation.completed
// ---------------------------------------------------------------------------

describe("evaluation.completed", () => {
  it("duplicate delivery → skipped before any download", async () => {
    mockFindEvaluationByToken.mockResolvedValue(evalRow());
    mockClaimWebhookEvent.mockResolvedValue("duplicate");

    const raw = JSON.stringify(completedPayload());
    await processJuezWebhook(raw, sign(raw));

    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(mockUpdateEvaluation).not.toHaveBeenCalled();
  });

  it("happy path: downloads, stores, delivers, timelines, emits, marks processed", async () => {
    mockFindEvaluationByToken.mockResolvedValue(
      evalRow({ attempts_used: 1, status: "in_progress", last_job_id: JOB_ID }),
    );
    mockFindRunByJobId.mockResolvedValue({ id: "run-1", status: "consumed" });
    mockSafeFetch.mockResolvedValue(pdfResponse());
    mockTransitionRun.mockResolvedValue(true);

    const raw = JSON.stringify(completedPayload());
    await processJuezWebhook(raw, sign(raw));

    expect(mockUploadBytesToStorage).toHaveBeenCalledWith(
      "generated",
      `evaluations/case-1/${JOB_ID}.pdf`,
      expect.anything(),
      "application/pdf",
    );
    expect(mockUpdateEvaluation).toHaveBeenCalledWith(
      "eval-1",
      expect.objectContaining({
        status: "delivered",
        pdf_storage_path: `evaluations/case-1/${JOB_ID}.pdf`,
        report_meta: { score: 62, nivel: "moderado", headline: "Caso sólido" },
      }),
    );
    expect(mockAppendCaseTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: "case-1", visibleToClient: true, color: "green" }),
    );
    expect(mockEmitCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: "case-1", evaluationId: "eval-1", jobId: JOB_ID }),
    );
    expect(mockMarkWebhookEventProcessed).toHaveBeenCalledWith("juez", `${JOB_ID}:completed`);
  });

  it("webhook-before-consume: creates the run and counts the attempt (run-derived sync)", async () => {
    mockFindEvaluationByToken.mockResolvedValue(evalRow());
    mockFindRunByJobId.mockResolvedValue(null);
    mockInsertRun.mockResolvedValue({ row: { id: "run-new" }, conflict: false });
    // sync: one consumed run → target 1; counter currently 0 → set 0→1
    mockListRunsForEvaluation.mockResolvedValue([{ id: "run-new", status: "consumed" }]);
    mockFindEvaluationById.mockResolvedValue(evalRow({ attempts_used: 0 }));
    mockSafeFetch.mockResolvedValue(pdfResponse());
    mockTransitionRun.mockResolvedValue(true);

    const raw = JSON.stringify(completedPayload());
    await processJuezWebhook(raw, sign(raw));

    expect(mockInsertRun).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: JOB_ID, status: "consumed" }),
    );
    expect(mockSetAttemptsUsed).toHaveBeenCalledWith("eval-1", 0, 1);
    expect(mockMarkWebhookEventProcessed).toHaveBeenCalled();
  });

  it("rejects a non-whitelisted pdf host WITHOUT marking processed (500 → retry)", async () => {
    mockFindEvaluationByToken.mockResolvedValue(evalRow());
    mockFindRunByJobId.mockResolvedValue({ id: "run-1", status: "consumed" });

    const raw = JSON.stringify(
      completedPayload({
        result: { pdfUrl: "https://evil.blob.vercel-storage.com.evil.com/x.pdf" },
      }),
    );
    await expect(processJuezWebhook(raw, sign(raw))).rejects.toMatchObject({
      code: "PDF_HOST_NOT_ALLOWED",
    });
    expect(mockMarkWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it("rejects an oversized PDF", async () => {
    mockFindEvaluationByToken.mockResolvedValue(evalRow());
    mockFindRunByJobId.mockResolvedValue({ id: "run-1", status: "consumed" });
    const big = {
      ok: true,
      status: 200,
      headers: { get: () => String(26 * 1024 * 1024) },
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
    mockSafeFetch.mockResolvedValue(big);

    const raw = JSON.stringify(completedPayload());
    await expect(processJuezWebhook(raw, sign(raw))).rejects.toMatchObject({
      code: "PDF_TOO_LARGE",
    });
  });

  it("rejects bytes that are not a PDF", async () => {
    mockFindEvaluationByToken.mockResolvedValue(evalRow());
    mockFindRunByJobId.mockResolvedValue({ id: "run-1", status: "consumed" });
    mockSafeFetch.mockResolvedValue(pdfResponse(Buffer.from("<html>not a pdf</html>")));
    mockValidateMagicBytes.mockReturnValue({ ok: false, reason: "spoof" });

    const raw = JSON.stringify(completedPayload());
    await expect(processJuezWebhook(raw, sign(raw))).rejects.toMatchObject({
      code: "PDF_INVALID",
    });
  });
});

// ---------------------------------------------------------------------------
// evaluation.failed — refund exactly once
// ---------------------------------------------------------------------------

describe("evaluation.failed", () => {
  function failedPayload() {
    return {
      event: "evaluation.failed",
      token: TOKEN,
      jobId: JOB_ID,
      error: "GENERATION_FAILED",
    };
  }

  it("refunds the attempt exactly once (run-derived counter sync)", async () => {
    mockFindEvaluationByToken.mockResolvedValue(
      evalRow({ attempts_used: 1, status: "in_progress" }),
    );
    mockFindRunByJobId.mockResolvedValue({ id: "run-1", status: "consumed" });
    mockTransitionRun.mockResolvedValue(true);
    // sync: the run is now failed → target 0; counter is 1 → set 1→0 (refund)
    mockListRunsForEvaluation.mockResolvedValue([{ id: "run-1", status: "failed" }]);
    mockFindEvaluationById.mockResolvedValue(evalRow({ attempts_used: 1 }));

    const raw = JSON.stringify(failedPayload());
    await processJuezWebhook(raw, sign(raw));

    expect(mockTransitionRun).toHaveBeenCalledWith(
      "run-1",
      "consumed",
      expect.objectContaining({ status: "failed" }),
    );
    expect(mockSetAttemptsUsed).toHaveBeenCalledWith("eval-1", 1, 0);
    expect(mockSetAttemptsUsed).toHaveBeenCalledTimes(1);
    expect(mockEmitFailed).toHaveBeenCalled();
    expect(mockMarkWebhookEventProcessed).toHaveBeenCalledWith("juez", `${JOB_ID}:failed`);
  });

  it("crash-recovery: run already failed on a prior attempt → the refund still converges", async () => {
    // Simulates the STRONG-2 scenario: a prior invocation transitioned the run
    // to failed but died before refunding. The webhook_events retry re-runs the
    // handler: transition CAS fails (already failed) but the sync still refunds.
    mockFindEvaluationByToken.mockResolvedValue(
      evalRow({ attempts_used: 1, status: "in_progress" }),
    );
    mockFindRunByJobId.mockResolvedValue({ id: "run-1", status: "failed" });
    mockListRunsForEvaluation.mockResolvedValue([{ id: "run-1", status: "failed" }]);
    mockFindEvaluationById.mockResolvedValue(evalRow({ attempts_used: 1 }));

    const raw = JSON.stringify(failedPayload());
    await processJuezWebhook(raw, sign(raw));

    expect(mockTransitionRun).not.toHaveBeenCalled();
    expect(mockSetAttemptsUsed).toHaveBeenCalledWith("eval-1", 1, 0);
  });

  it("second failed for the same jobId is a duplicate no-op", async () => {
    mockFindEvaluationByToken.mockResolvedValue(evalRow({ attempts_used: 1 }));
    mockClaimWebhookEvent.mockResolvedValue("duplicate");

    const raw = JSON.stringify(failedPayload());
    await processJuezWebhook(raw, sign(raw));

    expect(mockTransitionRun).not.toHaveBeenCalled();
    expect(mockSetAttemptsUsed).not.toHaveBeenCalled();
  });

  it("failed after completed never refunds (completed runs keep counting)", async () => {
    mockFindEvaluationByToken.mockResolvedValue(
      evalRow({ status: "delivered", pdf_storage_path: "evaluations/case-1/x.pdf", attempts_used: 1 }),
    );
    mockFindRunByJobId.mockResolvedValue({ id: "run-1", status: "completed" });
    // sync: completed run still counts → target 1 == counter 1 → no swap
    mockListRunsForEvaluation.mockResolvedValue([{ id: "run-1", status: "completed" }]);
    mockFindEvaluationById.mockResolvedValue(evalRow({ attempts_used: 1 }));

    const raw = JSON.stringify(failedPayload());
    await processJuezWebhook(raw, sign(raw));

    expect(mockTransitionRun).not.toHaveBeenCalled();
    expect(mockSetAttemptsUsed).not.toHaveBeenCalled();
    // delivered session state is never downgraded
    expect(mockUpdateEvaluation).not.toHaveBeenCalled();
  });

  it("failed without a prior run records it without touching counters", async () => {
    mockFindEvaluationByToken.mockResolvedValue(evalRow());
    mockFindRunByJobId.mockResolvedValue(null);
    mockInsertRun.mockResolvedValue({ row: { id: "run-x" }, conflict: false });
    // sync: only a failed run → target 0 == counter 0 → no swap
    mockListRunsForEvaluation.mockResolvedValue([{ id: "run-x", status: "failed" }]);
    mockFindEvaluationById.mockResolvedValue(evalRow({ attempts_used: 0 }));

    const raw = JSON.stringify(failedPayload());
    await processJuezWebhook(raw, sign(raw));

    expect(mockInsertRun).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(mockSetAttemptsUsed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// grantExtraAttempt
// ---------------------------------------------------------------------------

describe("grantExtraAttempt", () => {
  it("admin: +1 attempts_allowed, audited, failed→pending", async () => {
    mockGetExternalTool.mockResolvedValue({
      serviceId: "svc-1",
      toolKey: "juez",
      isEnabled: true,
      baseUrl: "https://juez.vercel.app",
      defaultAttempts: 1,
      instructionsI18n: {},
    });
    mockFindCaseBasic.mockResolvedValue(caseCols);
    mockFindEvaluationByCase.mockResolvedValue(evalRow({ status: "failed", attempts_used: 1 }));
    mockListRunsForEvaluation.mockResolvedValue([]);

    await grantExtraAttempt(adminActor, "case-1");

    expect(mockUpdateEvaluation).toHaveBeenCalledWith(
      "eval-1",
      expect.objectContaining({ attempts_allowed: 2, status: "pending" }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      adminActor,
      "evaluation.attempt_granted",
      "case_evaluations",
      "eval-1",
      expect.anything(),
    );
  });

  it("non-admin staff is rejected", async () => {
    const sales: Actor = { ...adminActor, role: "sales" };
    await expect(grantExtraAttempt(sales, "case-1")).rejects.toMatchObject({
      reason: "forbidden_module",
    });
    expect(mockUpdateEvaluation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getSessionForJuez
// ---------------------------------------------------------------------------

describe("getSessionForJuez", () => {
  it("returns minimum client data + signed pdf url when delivered", async () => {
    mockFindEvaluationByToken.mockResolvedValue(
      evalRow({
        status: "delivered",
        pdf_storage_path: "evaluations/case-1/x.pdf",
        attempts_used: 1,
      }),
    );
    mockFindClientInfoForCase.mockResolvedValue({
      name: "María González",
      email: "maria@example.com",
      country: "Venezuela",
    });

    const dto = await getSessionForJuez(TOKEN);
    expect(dto).toMatchObject({
      client: { name: "María González", email: "maria@example.com", country: "Venezuela" },
      attemptsAllowed: 1,
      attemptsUsed: 1,
      status: "delivered",
      pdfUrl: "https://signed.example/x.pdf",
    });
  });

  it("returns null for unknown tokens", async () => {
    mockFindEvaluationByToken.mockResolvedValue(null);
    expect(await getSessionForJuez(TOKEN)).toBeNull();
  });
});
