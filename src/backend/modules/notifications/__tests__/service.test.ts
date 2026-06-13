/**
 * Notifications service — dispatcher matrix tests (TDD).
 *
 * Tests that the F2 matrix produces the correct notifications for each event.
 * Mocks: repository (no I/O), QStash, logger.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------

const mockInsertNotificationIdempotent = vi.hoisted(() => vi.fn());
const mockFindStaffByRole = vi.hoisted(() => vi.fn());
const mockFindCaseClientMembers = vi.hoisted(() => vi.fn());
const mockFindCaseAssignedStaff = vi.hoisted(() => vi.fn());
const mockFindUserById = vi.hoisted(() => vi.fn());
const mockEnqueueJob = vi.hoisted(() => vi.fn());

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("../repository.js", () => ({
  insertNotificationIdempotent: mockInsertNotificationIdempotent,
  findStaffByRole: mockFindStaffByRole,
  findCaseClientMembers: mockFindCaseClientMembers,
  findCaseAssignedStaff: mockFindCaseAssignedStaff,
  findUserById: mockFindUserById,
  listNotificationsForUser: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  markNotificationRead: vi.fn().mockResolvedValue(undefined),
  findNotificationById: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/backend/platform/qstash", () => ({
  enqueueJob: mockEnqueueJob,
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are registered
import { notifyFromEvent } from "../service";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const CASE_ID = "00000000-0000-0000-0000-000000000001";
const DOC_ID = "00000000-0000-0000-0000-000000000002";
const CONTRACT_ID = "00000000-0000-0000-0000-000000000003";
const FINANCE_USER_ID = "00000000-0000-0000-0000-000000000010";
const SALES_USER_ID = "00000000-0000-0000-0000-000000000011";
const PARALEGAL_USER_ID = "00000000-0000-0000-0000-000000000012";
const CLIENT_USER_ID = "00000000-0000-0000-0000-000000000013";

const NOTIFICATION_ID = "00000000-0000-0000-0000-000000000099";

beforeEach(() => {
  vi.clearAllMocks();

  // Default: notification is newly created
  mockInsertNotificationIdempotent.mockResolvedValue({
    row: { id: NOTIFICATION_ID },
    created: true,
  });

  // Default: enqueue succeeds
  mockEnqueueJob.mockResolvedValue({ messageId: "msg-123" });

  // Default: user has email, not bounced
  mockFindUserById.mockResolvedValue({
    id: CLIENT_USER_ID,
    email: "client@example.com",
    emailBouncedAt: null,
    locale: "es",
    kind: "client",
  });

  // Default resolved staff
  mockFindStaffByRole.mockResolvedValue([FINANCE_USER_ID]);
  mockFindCaseAssignedStaff.mockResolvedValue({
    salesId: SALES_USER_ID,
    paralegalId: PARALEGAL_USER_ID,
  });
  mockFindCaseClientMembers.mockResolvedValue([CLIENT_USER_ID]);
});

// ---------------------------------------------------------------------------
// contract.signed
// ---------------------------------------------------------------------------

describe("notifyFromEvent('contract.signed')", () => {
  it("notifies finance AND sales", async () => {
    await notifyFromEvent({
      type: "contract.signed",
      payload: { contractId: CONTRACT_ID, caseId: CASE_ID },
      occurredAt: new Date(),
    });

    // Should have called insertNotificationIdempotent for finance + sales
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(2);

    // Finance gets email channel
    const financeCalls = mockInsertNotificationIdempotent.mock.calls.filter(
      ([input]) => input.userId === FINANCE_USER_ID,
    );
    expect(financeCalls).toHaveLength(1);
    expect(financeCalls[0][0].type).toBe("contract.signed");

    // Sales gets in-app only (no push/email channels)
    const salesCalls = mockInsertNotificationIdempotent.mock.calls.filter(
      ([input]) => input.userId === SALES_USER_ID,
    );
    expect(salesCalls).toHaveLength(1);
    expect(salesCalls[0][0].type).toBe("contract.signed");
  });

  it("enqueues email deliver-notification for finance with correct template key", async () => {
    mockFindUserById.mockResolvedValue({
      id: FINANCE_USER_ID,
      email: "finance@example.com",
      emailBouncedAt: null,
      locale: "es",
      kind: "staff",
    });

    await notifyFromEvent({
      type: "contract.signed",
      payload: { contractId: CONTRACT_ID, caseId: CASE_ID },
      occurredAt: new Date(),
    });

    const emailJobs = mockEnqueueJob.mock.calls.filter(
      ([payload]) => payload.channel === "email",
    );
    expect(emailJobs.length).toBeGreaterThanOrEqual(1);

    const financeEmailJob = emailJobs.find(
      ([payload]) => payload.templateKey === "contract-signed-finance",
    );
    expect(financeEmailJob).toBeDefined();
  });

  it("is idempotent — no new notification on re-delivery", async () => {
    // Simulate existing notification
    mockInsertNotificationIdempotent.mockResolvedValue({
      row: { id: NOTIFICATION_ID },
      created: false, // already exists
    });

    await notifyFromEvent({
      type: "contract.signed",
      payload: { contractId: CONTRACT_ID, caseId: CASE_ID },
      occurredAt: new Date(),
    });

    // No QStash jobs enqueued on re-delivery
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// document.approved
// ---------------------------------------------------------------------------

describe("notifyFromEvent('document.approved')", () => {
  it("notifies client(s) of the case", async () => {
    await notifyFromEvent({
      type: "document.approved",
      payload: { caseId: CASE_ID, documentId: DOC_ID },
      occurredAt: new Date(),
    });

    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(1);
    const [input] = mockInsertNotificationIdempotent.mock.calls[0];
    expect(input.userId).toBe(CLIENT_USER_ID);
    expect(input.type).toBe("document.approved");
  });

  it("uses green color (not red)", async () => {
    await notifyFromEvent({
      type: "document.approved",
      payload: { caseId: CASE_ID, documentId: DOC_ID },
      occurredAt: new Date(),
    });

    const [input] = mockInsertNotificationIdempotent.mock.calls[0];
    expect(input.color).toBe("green");
  });

  it("enqueues email with document-approved template", async () => {
    await notifyFromEvent({
      type: "document.approved",
      payload: { caseId: CASE_ID, documentId: DOC_ID },
      occurredAt: new Date(),
    });

    const emailJobs = mockEnqueueJob.mock.calls.filter(
      ([payload]) => payload.channel === "email",
    );
    const docApprovedEmail = emailJobs.find(
      ([payload]) => payload.templateKey === "document-approved",
    );
    expect(docApprovedEmail).toBeDefined();
  });

  it("no notification when no clients in case", async () => {
    mockFindCaseClientMembers.mockResolvedValue([]);

    await notifyFromEvent({
      type: "document.approved",
      payload: { caseId: CASE_ID, documentId: DOC_ID },
      occurredAt: new Date(),
    });

    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// document.rejected
// ---------------------------------------------------------------------------

describe("notifyFromEvent('document.rejected')", () => {
  it("notifies client(s) with amber color (never red)", async () => {
    await notifyFromEvent({
      type: "document.rejected",
      payload: { caseId: CASE_ID, documentId: DOC_ID },
      occurredAt: new Date(),
    });

    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(1);
    const [input] = mockInsertNotificationIdempotent.mock.calls[0];
    expect(input.userId).toBe(CLIENT_USER_ID);
    expect(input.color).toBe("amber"); // RF-TRX-022: correction is amber, never red
  });

  it("enqueues email with document-rejected template", async () => {
    await notifyFromEvent({
      type: "document.rejected",
      payload: { caseId: CASE_ID, documentId: DOC_ID },
      occurredAt: new Date(),
    });

    const emailJobs = mockEnqueueJob.mock.calls.filter(
      ([payload]) => payload.channel === "email" && payload.templateKey === "document-rejected",
    );
    expect(emailJobs).toHaveLength(1);
  });

  it("action_url includes documentId for deep link to correction screen", async () => {
    await notifyFromEvent({
      type: "document.rejected",
      payload: { caseId: CASE_ID, documentId: DOC_ID },
      occurredAt: new Date(),
    });

    const [input] = mockInsertNotificationIdempotent.mock.calls[0];
    expect(input.actionUrl).toContain(DOC_ID);
    expect(input.actionUrl).toContain(CASE_ID);
  });
});

// ---------------------------------------------------------------------------
// downpayment.confirmed
// ---------------------------------------------------------------------------

describe("notifyFromEvent('downpayment.confirmed')", () => {
  it("notifies sales (①②③), paralegal (①), and client (③)", async () => {
    await notifyFromEvent({
      type: "downpayment.confirmed",
      payload: { caseId: CASE_ID, installmentId: "inst-1" },
      occurredAt: new Date(),
    });

    // Should have called for sales + paralegal + client = 3 recipients
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(3);

    const userIds = mockInsertNotificationIdempotent.mock.calls.map(
      ([input]) => input.userId,
    );
    expect(userIds).toContain(SALES_USER_ID);
    expect(userIds).toContain(PARALEGAL_USER_ID);
    expect(userIds).toContain(CLIENT_USER_ID);
  });

  it("sends downpayment-confirmed-sales email to sales", async () => {
    mockFindUserById.mockImplementation(async (id: string) => ({
      id,
      email: `${id}@example.com`,
      emailBouncedAt: null,
      locale: "es",
      kind: id === CLIENT_USER_ID ? "client" : "staff",
    }));

    await notifyFromEvent({
      type: "downpayment.confirmed",
      payload: { caseId: CASE_ID, installmentId: "inst-1" },
      occurredAt: new Date(),
    });

    const salesEmailJobs = mockEnqueueJob.mock.calls.filter(
      ([payload]) =>
        payload.channel === "email" &&
        payload.templateKey === "downpayment-confirmed-sales",
    );
    expect(salesEmailJobs.length).toBeGreaterThanOrEqual(1);
  });

  it("sends downpayment-confirmed email to client", async () => {
    mockFindUserById.mockImplementation(async (id: string) => ({
      id,
      email: `${id}@example.com`,
      emailBouncedAt: null,
      locale: "es",
      kind: id === CLIENT_USER_ID ? "client" : "staff",
    }));

    await notifyFromEvent({
      type: "downpayment.confirmed",
      payload: { caseId: CASE_ID, installmentId: "inst-1" },
      occurredAt: new Date(),
    });

    const clientEmailJobs = mockEnqueueJob.mock.calls.filter(
      ([payload]) =>
        payload.channel === "email" &&
        payload.templateKey === "downpayment-confirmed" &&
        payload.recipientEmail === `${CLIENT_USER_ID}@example.com`,
    );
    expect(clientEmailJobs.length).toBeGreaterThanOrEqual(1);
  });

  it("no-ops for unknown event types", async () => {
    await notifyFromEvent({
      type: "case.created",
      payload: { caseId: CASE_ID },
      occurredAt: new Date(),
    });

    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
  });

  // C-2 FIX: downpayment-confirmed → client rule has unsuppressible:true.
  // Verify that even when the rule is suppresible by default the welcome email
  // (unsuppressible:true) is always enqueued.
  it("C-2: unsuppressible:true rule always enqueues email (downpayment-confirmed client)", async () => {
    mockFindUserById.mockImplementation(async (id: string) => ({
      id,
      email: `${id}@example.com`,
      emailBouncedAt: null,
      locale: "es",
      kind: id === CLIENT_USER_ID ? "client" : "staff",
    }));

    await notifyFromEvent({
      type: "downpayment.confirmed",
      payload: { caseId: CASE_ID, installmentId: "inst-1" },
      occurredAt: new Date(),
    });

    // The client downpayment-confirmed email MUST be enqueued (unsuppressible:true)
    const clientWelcomeJobs = mockEnqueueJob.mock.calls.filter(
      ([payload]) =>
        payload.channel === "email" &&
        payload.templateKey === "downpayment-confirmed" &&
        payload.recipientEmail === `${CLIENT_USER_ID}@example.com`,
    );
    expect(clientWelcomeJobs).toHaveLength(1);
  });
});
