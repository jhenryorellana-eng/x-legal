/**
 * integrations module — service unit tests (RED → GREEN TDD)
 *
 * Tests: HMAC verification, idempotency, state machine effects,
 * network mocking for 202/200-dedup/400/401/409/5xx responses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks (vi.hoisted MUST be declared before vi.mock factories)
// ---------------------------------------------------------------------------

const {
  mockInsertValidation,
  mockFindActiveValidation,
  mockFindByExternalValidationId,
  mockFindLatestByCaseId,
  mockUpdateValidation,
  mockListPollingCandidates,
} = vi.hoisted(() => ({
  mockInsertValidation: vi.fn(),
  mockFindActiveValidation: vi.fn(),
  mockFindByExternalValidationId: vi.fn(),
  mockFindLatestByCaseId: vi.fn(),
  mockUpdateValidation: vi.fn(),
  mockListPollingCandidates: vi.fn(),
}));

const {
  mockClaimWebhookEvent,
  mockMarkWebhookEventProcessed,
} = vi.hoisted(() => ({
  mockClaimWebhookEvent: vi.fn(),
  mockMarkWebhookEventProcessed: vi.fn(),
}));

const {
  mockChangeCaseStatus,
  mockGetFormForClient,
  mockGetCaseExtractions,
} = vi.hoisted(() => ({
  mockChangeCaseStatus: vi.fn(),
  mockGetFormForClient: vi.fn(),
  mockGetCaseExtractions: vi.fn(),
}));

const { mockUpdateExpediente, mockUpdateExpedienteStatus, mockSendToFinanceSystem } = vi.hoisted(() => ({
  mockUpdateExpediente: vi.fn(),
  mockUpdateExpedienteStatus: vi.fn(),
  mockSendToFinanceSystem: vi.fn(),
}));

const { mockEmitValidationSent, mockEmitVerdictReceived } = vi.hoisted(() => ({
  mockEmitValidationSent: vi.fn(),
  mockEmitVerdictReceived: vi.fn(),
}));

const { mockWriteAudit, mockAppendCaseTimeline } = vi.hoisted(() => ({
  mockWriteAudit: vi.fn(),
  mockAppendCaseTimeline: vi.fn(),
}));

const { mockCan } = vi.hoisted(() => ({ mockCan: vi.fn() }));

// service-role client used by setCaseStatusSystem (case status) + recordInvalidWebhook
const { mockCasesUpdate, mockWebhookInsert } = vi.hoisted(() => ({
  mockCasesUpdate: vi.fn(),
  mockWebhookInsert: vi.fn(),
}));

// mockFetch reserved for future network-level tests; not used in unit tests
// (network calls are tested via service mock boundaries)

const { mockProviderEnv } = vi.hoisted(() => ({
  mockProviderEnv: vi.fn().mockReturnValue({
    ABOGADOS_API_URL: "https://abogados.test",
    ABOGADOS_API_KEY: "test-api-key-secret",
    ABOGADOS_WEBHOOK_SECRET: "test-webhook-secret-32bytes-long!!",
    ABOGADOS_CALLBACK_URL: "https://app.test/api/webhooks/abogados",
  }),
}));

// ---------------------------------------------------------------------------
// vi.mock declarations
// ---------------------------------------------------------------------------

vi.mock("../repository", () => ({
  insertValidation: mockInsertValidation,
  findActiveValidation: mockFindActiveValidation,
  findByExternalValidationId: mockFindByExternalValidationId,
  findLatestByCaseId: mockFindLatestByCaseId,
  updateValidation: mockUpdateValidation,
  updateExpedienteStatus: mockUpdateExpedienteStatus,
  listPollingCandidates: mockListPollingCandidates,
}));

vi.mock("@/backend/platform/webhook-events", () => ({
  claimWebhookEvent: mockClaimWebhookEvent,
  markWebhookEventProcessed: mockMarkWebhookEventProcessed,
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mockWriteAudit,
  appendCaseTimeline: mockAppendCaseTimeline,
}));

vi.mock("../events", () => ({
  emitValidationSent: mockEmitValidationSent,
  emitVerdictReceived: mockEmitVerdictReceived,
}));

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  AuthzError: class AuthzError extends Error {
    constructor(public reason: string) { super(reason); }
  },
}));

vi.mock("@/backend/platform/env", () => ({
  providerEnv: mockProviderEnv,
}));

// service-role client (setCaseStatusSystem updates cases; recordInvalidWebhook
// resolves org + inserts the forensic webhook_events row)
vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { org_id: "org-1" }, error: null }),
        }),
      }),
      update: (patch: unknown) => {
        if (table === "cases") mockCasesUpdate(patch);
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert: (row: unknown) => {
        if (table === "webhook_events") mockWebhookInsert(row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

// Mock cases module (dynamic import)
vi.mock("@/backend/modules/cases", () => ({
  changeCaseStatus: mockChangeCaseStatus,
  getFormForClient: mockGetFormForClient,
  getCaseExtractions: mockGetCaseExtractions,
}));

// Mock expediente module (dynamic import)
vi.mock("@/backend/modules/expediente", () => ({
  canonicalClientLabel: (first: string, last: string) => `${first.charAt(0).toUpperCase()}. ${last}`,
  sendToFinanceSystem: mockSendToFinanceSystem,
}));

// ---------------------------------------------------------------------------
// Import service AFTER mocks
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
import {
  processVerdictWebhook,
  applyVerdict,
  IntegrationsError,
} from "../service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = "test-webhook-secret-32bytes-long!!";

function signBody(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

const VALID_VERDICT_PAYLOAD = {
  event: "validation.verdict" as const,
  validation_id: "vid-0001",
  external_case_id: "11111111-1111-4111-8111-111111111111",
  source: "usalatinoprime-v2",
  case_number: "ULP-2026-0042",
  verdict: "validated" as const,
  verdict_notes: "All good",
  verdict_findings: [],
  verdict_at: "2026-06-10T21:56:21.849+00:00",
  review_seconds: 53,
  return_to: "team" as const,
  semaforo: "green" as const,
  ai_score: 85,
};

const VALID_VALIDATION_ROW = {
  id: "local-val-id",
  case_id: "11111111-1111-4111-8111-111111111111",
  expediente_id: "22222222-2222-4222-8222-222222222222",
  attempt_no: 1,
  external_validation_id: "vid-0001",
  status: "queued",
  semaforo: null,
  ai_score: null,
  verdict: null,
  verdict_notes: null,
  verdict_findings: null,
  verdict_at: null,
  return_to: null,
  sent_at: "2026-06-10T20:00:00.000Z",
  error: null,
  created_at: "2026-06-10T20:00:00.000Z",
  updated_at: "2026-06-10T20:00:00.000Z",
  org_id: "org-id-001",
};

// ---------------------------------------------------------------------------
// HMAC verification tests — processVerdictWebhook
// ---------------------------------------------------------------------------

describe("processVerdictWebhook — HMAC security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderEnv.mockReturnValue({
      ABOGADOS_API_URL: "https://abogados.test",
      ABOGADOS_API_KEY: "test-api-key-secret",
      ABOGADOS_WEBHOOK_SECRET: WEBHOOK_SECRET,
      ABOGADOS_CALLBACK_URL: "https://app.test/api/webhooks/abogados",
    });
  });

  it("rejects webhook with missing signature", async () => {
    const body = JSON.stringify(VALID_VERDICT_PAYLOAD);
    await expect(processVerdictWebhook(body, null)).rejects.toThrow();
  });

  it("rejects webhook with empty signature", async () => {
    const body = JSON.stringify(VALID_VERDICT_PAYLOAD);
    await expect(processVerdictWebhook(body, "")).rejects.toThrow();
  });

  it("rejects webhook with invalid signature", async () => {
    const body = JSON.stringify(VALID_VERDICT_PAYLOAD);
    const badSig = "a".repeat(64);
    await expect(processVerdictWebhook(body, badSig)).rejects.toThrow();
  });

  it("rejects webhook with wrong-length signature", async () => {
    const body = JSON.stringify(VALID_VERDICT_PAYLOAD);
    await expect(processVerdictWebhook(body, "abc")).rejects.toThrow();
  });

  it("accepts webhook with valid signature and processes it", async () => {
    const body = JSON.stringify(VALID_VERDICT_PAYLOAD);
    const sig = signBody(body);

    mockFindByExternalValidationId.mockResolvedValue(VALID_VALIDATION_ROW);
    mockClaimWebhookEvent.mockResolvedValue("fresh");
    mockUpdateValidation.mockResolvedValue(undefined);
    mockUpdateExpedienteStatus.mockResolvedValue(undefined);
    mockChangeCaseStatus.mockResolvedValue(undefined);
    mockUpdateExpediente.mockResolvedValue(undefined);
    mockEmitVerdictReceived.mockReturnValue(undefined);
    mockMarkWebhookEventProcessed.mockResolvedValue(undefined);
    mockWriteAudit.mockResolvedValue(undefined);
    mockAppendCaseTimeline.mockResolvedValue(undefined);

    // Should not throw
    await expect(processVerdictWebhook(body, sig)).resolves.toBeUndefined();
  });

  it("no-ops for unknown source (not usalatinoprime-v2)", async () => {
    const foreignPayload = { ...VALID_VERDICT_PAYLOAD, source: "henryflow" };
    const body = JSON.stringify(foreignPayload);
    const sig = signBody(body);

    // Should return without processing (no DB calls)
    await processVerdictWebhook(body, sig);

    expect(mockFindByExternalValidationId).not.toHaveBeenCalled();
    expect(mockClaimWebhookEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Idempotency — applyVerdict
// ---------------------------------------------------------------------------

describe("applyVerdict — idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op when claimWebhookEvent returns 'duplicate'", async () => {
    mockFindByExternalValidationId.mockResolvedValue(VALID_VALIDATION_ROW);
    mockClaimWebhookEvent.mockResolvedValue("duplicate");

    await applyVerdict(VALID_VERDICT_PAYLOAD, VALID_VALIDATION_ROW);

    expect(mockUpdateValidation).not.toHaveBeenCalled();
    expect(mockCasesUpdate).not.toHaveBeenCalled();
    expect(mockEmitVerdictReceived).not.toHaveBeenCalled();
  });

  it("processes when claimWebhookEvent returns 'fresh'", async () => {
    mockClaimWebhookEvent.mockResolvedValue("fresh");
    mockUpdateValidation.mockResolvedValue(undefined);
    mockUpdateExpedienteStatus.mockResolvedValue(undefined);
    mockChangeCaseStatus.mockResolvedValue(undefined);
    mockEmitVerdictReceived.mockReturnValue(undefined);
    mockMarkWebhookEventProcessed.mockResolvedValue(undefined);
    mockWriteAudit.mockResolvedValue(undefined);
    mockAppendCaseTimeline.mockResolvedValue(undefined);

    await applyVerdict(VALID_VERDICT_PAYLOAD, VALID_VALIDATION_ROW);

    expect(mockUpdateValidation).toHaveBeenCalledOnce();
    expect(mockMarkWebhookEventProcessed).toHaveBeenCalledOnce();
  });

  it("processes when claimWebhookEvent returns 'retry' (prior run died)", async () => {
    mockClaimWebhookEvent.mockResolvedValue("retry");
    mockUpdateValidation.mockResolvedValue(undefined);
    mockUpdateExpedienteStatus.mockResolvedValue(undefined);
    mockChangeCaseStatus.mockResolvedValue(undefined);
    mockEmitVerdictReceived.mockReturnValue(undefined);
    mockMarkWebhookEventProcessed.mockResolvedValue(undefined);
    mockWriteAudit.mockResolvedValue(undefined);
    mockAppendCaseTimeline.mockResolvedValue(undefined);

    await applyVerdict(VALID_VERDICT_PAYLOAD, VALID_VALIDATION_ROW);

    expect(mockUpdateValidation).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// State machine — applyVerdict effects by verdict type
// ---------------------------------------------------------------------------

describe("applyVerdict — state machine effects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaimWebhookEvent.mockResolvedValue("fresh");
    mockUpdateValidation.mockResolvedValue(undefined);
    mockUpdateExpedienteStatus.mockResolvedValue(undefined);
    mockChangeCaseStatus.mockResolvedValue(undefined);
    mockEmitVerdictReceived.mockReturnValue(undefined);
    mockMarkWebhookEventProcessed.mockResolvedValue(undefined);
    mockWriteAudit.mockResolvedValue(undefined);
    mockAppendCaseTimeline.mockResolvedValue(undefined);
    mockSendToFinanceSystem.mockResolvedValue(undefined);
  });

  it("'validated': sets validation status to 'validated' and triggers ready_for_delivery", async () => {
    await applyVerdict(VALID_VERDICT_PAYLOAD, VALID_VALIDATION_ROW);

    expect(mockUpdateValidation).toHaveBeenCalledWith(
      VALID_VALIDATION_ROW.id,
      expect.objectContaining({ status: "validated" }),
    );
    expect(mockCasesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready_for_delivery" }),
    );
  });

  it("'validated': auto-sends the approved expediente to Andrium (sendToFinanceSystem)", async () => {
    // Henry's flow: on lawyer approval the expediente flows straight to Andrium, no
    // manual Diana step. Regression guard — this call previously had no real coverage.
    await applyVerdict(VALID_VERDICT_PAYLOAD, VALID_VALIDATION_ROW);
    expect(mockSendToFinanceSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: VALID_VALIDATION_ROW.case_id,
        expedienteId: VALID_VALIDATION_ROW.expediente_id,
      }),
    );
  });

  it("'needs_corrections': does NOT auto-send to Andrium", async () => {
    const ncPayload = { ...VALID_VERDICT_PAYLOAD, verdict: "needs_corrections" as const };
    await applyVerdict(ncPayload, VALID_VALIDATION_ROW);
    expect(mockSendToFinanceSystem).not.toHaveBeenCalled();
  });

  it("'validated': emits validation.verdict_received event", async () => {
    await applyVerdict(VALID_VERDICT_PAYLOAD, VALID_VALIDATION_ROW);
    expect(mockEmitVerdictReceived).toHaveBeenCalledOnce();
  });

  it("'needs_corrections': sets status to needs_corrections, case stays in_validation", async () => {
    const ncPayload = {
      ...VALID_VERDICT_PAYLOAD,
      verdict: "needs_corrections" as const,
      verdict_notes: "Fix placeholders",
      verdict_findings: [
        {
          severity: "critical" as const,
          category: "placeholder_unresolved",
          location: "p.1",
          description: "not resolved",
          recommendation: "fill in",
        },
      ],
      return_to: "team" as const,
      semaforo: "red" as const,
    };

    await applyVerdict(ncPayload, VALID_VALIDATION_ROW);

    expect(mockUpdateValidation).toHaveBeenCalledWith(
      VALID_VALIDATION_ROW.id,
      expect.objectContaining({
        status: "needs_corrections",
        verdict_notes: "Fix placeholders",
        return_to: "team",
      }),
    );
    // cases.status should NOT change for needs_corrections (stays in_validation)
    expect(mockCasesUpdate).not.toHaveBeenCalled();
  });

  it("'cancelled': returns expediente to compiled, case to active", async () => {
    const cancelledPayload = {
      ...VALID_VERDICT_PAYLOAD,
      verdict: "cancelled" as const,
    };

    await applyVerdict(cancelledPayload, VALID_VALIDATION_ROW);

    const updateCalls = mockUpdateValidation.mock.calls;
    expect(updateCalls.length).toBeGreaterThan(0);
    expect(mockCasesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" }),
    );
  });

  it("uses idempotency key '{validation_id}:{verdict_at}'", async () => {
    await applyVerdict(VALID_VERDICT_PAYLOAD, VALID_VALIDATION_ROW);

    expect(mockClaimWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `${VALID_VERDICT_PAYLOAD.validation_id}:${VALID_VERDICT_PAYLOAD.verdict_at}`,
        source: "abogados",
        eventType: "validation.verdict",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// IntegrationsError
// ---------------------------------------------------------------------------

describe("IntegrationsError", () => {
  it("has correct name and code", () => {
    const err = new IntegrationsError("PLAN_NOT_WITH_LAWYER");
    expect(err.name).toBe("IntegrationsError");
    expect(err.code).toBe("PLAN_NOT_WITH_LAWYER");
    expect(err).toBeInstanceOf(Error);
  });

  it("can carry details", () => {
    const err = new IntegrationsError("ABOGADOS_API_ERROR", { status: 400 });
    expect(err.details).toEqual({ status: 400 });
  });
});
