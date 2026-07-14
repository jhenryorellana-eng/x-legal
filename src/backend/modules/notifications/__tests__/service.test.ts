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
const mockGetPreferences = vi.hoisted(() => vi.fn());
const mockFindUnreadMessageDigest = vi.hoisted(() => vi.fn());
const mockBumpMessageDigest = vi.hoisted(() => vi.fn());
const ALL_TRUE_PREFS = vi.hoisted(() => ({
  messages: true,
  appointment_reminders: true,
  payment_reminders: true,
  case_updates: true,
  channels: { inapp: true, push: true, email: true },
}));

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
  findRecipientProfile: mockFindUserById,
  getPreferences: mockGetPreferences,
  upsertPreferences: vi.fn().mockResolvedValue(undefined),
  findUnreadMessageDigest: mockFindUnreadMessageDigest,
  bumpMessageDigest: mockBumpMessageDigest,
  markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
  getUnreadCountForUser: vi.fn().mockResolvedValue(0),
  listNotificationsForUser: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  markNotificationRead: vi.fn().mockResolvedValue(undefined),
  findNotificationById: vi.fn().mockResolvedValue(null),
  DEFAULT_PREFERENCES: ALL_TRUE_PREFS,
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

  // Default: all preference categories + channels ON (matches the all-true defaults)
  mockGetPreferences.mockResolvedValue(ALL_TRUE_PREFS);
  mockFindUnreadMessageDigest.mockResolvedValue(null);
  mockBumpMessageDigest.mockResolvedValue(undefined);

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

    // Should have called insertNotificationIdempotent for finance + sales + client
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(3);

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

    // Client gets the "make your initial payment" variant (onboarding flow)
    const clientCalls = mockInsertNotificationIdempotent.mock.calls.filter(
      ([input]) => input.userId === CLIENT_USER_ID,
    );
    expect(clientCalls).toHaveLength(1);
    expect(clientCalls[0][0].type).toBe("contract.signed.client");
    // Client deep-links to the account-level payments screen (/pagos exists; there
    // is no /caso/{id}/pagos route).
    expect(clientCalls[0][0].actionUrl).toBe("/pagos");
    // Finance deep-links to its own payments view (not /admin/cobranza, which 404s).
    expect(financeCalls[0][0].actionUrl).toBe(`/finanzas/pagos?caseId=${CASE_ID}`);
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
  it("notifies sales (①②③), paralegal (①), client (③), and finance (①②)", async () => {
    await notifyFromEvent({
      type: "downpayment.confirmed",
      payload: { caseId: CASE_ID, installmentId: "inst-1" },
      occurredAt: new Date(),
    });

    // sales + paralegal + client + finance = 4 recipients (finance added per onboarding flow)
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(4);

    const userIds = mockInsertNotificationIdempotent.mock.calls.map(
      ([input]) => input.userId,
    );
    expect(userIds).toContain(SALES_USER_ID);
    expect(userIds).toContain(PARALEGAL_USER_ID);
    expect(userIds).toContain(CLIENT_USER_ID);
    expect(userIds).toContain(FINANCE_USER_ID);

    // Deep links resolve to real routes per recipient (no bare /caso/{id} or
    // /legal/caso/ 404s).
    const byUser = (uid: string) =>
      mockInsertNotificationIdempotent.mock.calls.find(([i]) => i.userId === uid)![0];
    expect(byUser(CLIENT_USER_ID).actionUrl).toBe(`/caso/${CASE_ID}/camino`);
    expect(byUser(PARALEGAL_USER_ID).actionUrl).toBe(`/legal/expediente/${CASE_ID}`);
    expect(byUser(FINANCE_USER_ID).actionUrl).toBe(`/finanzas/pagos?caseId=${CASE_ID}`);
    expect(byUser(SALES_USER_ID).actionUrl).toBe(`/ventas/clientes/${CASE_ID}`);
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
      type: "some.unmapped.event",
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

// ---------------------------------------------------------------------------
// F7-Ola7b — preference gating (categories + channels)
// ---------------------------------------------------------------------------

describe("notifyFromEvent — preference gating (F7-Ola7b)", () => {
  it("category OFF suppresses a suppressible rule entirely (no in-app row)", async () => {
    mockGetPreferences.mockResolvedValue({ ...ALL_TRUE_PREFS, payment_reminders: false });
    await notifyFromEvent({
      type: "installment.overdue",
      payload: { caseId: CASE_ID, installmentId: "inst-9" },
      occurredAt: new Date(),
    });
    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
  });

  it("category ON inserts in-app but channel OFF skips push", async () => {
    mockGetPreferences.mockResolvedValue({
      ...ALL_TRUE_PREFS,
      channels: { inapp: true, push: false, email: true },
    });
    await notifyFromEvent({
      type: "installment.overdue",
      payload: { caseId: CASE_ID, installmentId: "inst-9" },
      occurredAt: new Date(),
    });
    // in-app row still created for the client
    const clientInserts = mockInsertNotificationIdempotent.mock.calls.filter(
      ([i]) => i.userId === CLIENT_USER_ID,
    );
    expect(clientInserts.length).toBeGreaterThanOrEqual(1);
    // but NO push job enqueued (channel off)
    const pushJobs = mockEnqueueJob.mock.calls.filter(([p]) => p.channel === "push");
    expect(pushJobs).toHaveLength(0);
  });

  it("unsuppressible rule ignores category AND channel prefs (welcome email)", async () => {
    mockGetPreferences.mockResolvedValue({
      ...ALL_TRUE_PREFS,
      case_updates: false,
      channels: { inapp: true, push: false, email: false },
    });
    mockFindUserById.mockResolvedValue({
      id: CLIENT_USER_ID,
      email: "client@example.com",
      emailBouncedAt: null,
      locale: "es",
      kind: "client",
    });
    await notifyFromEvent({
      type: "downpayment.confirmed",
      payload: { caseId: CASE_ID },
      occurredAt: new Date(),
    });
    const welcome = mockEnqueueJob.mock.calls.find(
      ([p]) => p.channel === "email" && p.templateKey === "downpayment-confirmed",
    );
    expect(welcome).toBeDefined(); // ◆ sent despite both prefs off
  });
});

// ---------------------------------------------------------------------------
// F7-Ola7b — message.sent anti-burst (DOC-47 §4.2 / §5.2)
// ---------------------------------------------------------------------------

describe("notifyFromEvent — message.sent anti-burst (F7-Ola7b)", () => {
  const burst = {
    type: "message.sent" as const,
    payload: {
      messageId: "msg-1",
      conversationId: "conv-1",
      caseId: CASE_ID,
      senderUserId: SALES_USER_ID,
      recipientIds: [CLIENT_USER_ID],
    },
    occurredAt: new Date(),
  };

  it("first message creates a message.received row + push with 5s grace", async () => {
    mockFindUnreadMessageDigest.mockResolvedValue(null);
    await notifyFromEvent(burst);

    const inserts = mockInsertNotificationIdempotent.mock.calls.filter(
      ([i]) => i.type === "message.received" && i.userId === CLIENT_USER_ID,
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0].dedupeKey).toBe(`message.sent:msg-1:${CLIENT_USER_ID}`);

    const pushJob = mockEnqueueJob.mock.calls.find(([p]) => p.channel === "push");
    expect(pushJob).toBeDefined();
    expect(pushJob![1]).toMatchObject({ delay: 5 }); // grace period
    expect(mockBumpMessageDigest).not.toHaveBeenCalled();
  });

  it("second message within window bumps the digest — no new row, no push", async () => {
    mockFindUnreadMessageDigest.mockResolvedValue({
      id: "notif-1",
      created_at: new Date().toISOString(),
      body_i18n: { es: "Nuevo mensaje", en: "New message" },
    });
    await notifyFromEvent(burst);

    expect(mockBumpMessageDigest).toHaveBeenCalledTimes(1);
    const inserts = mockInsertNotificationIdempotent.mock.calls.filter(
      ([i]) => i.type === "message.received",
    );
    expect(inserts).toHaveLength(0);
    const pushJob = mockEnqueueJob.mock.calls.find(([p]) => p.channel === "push");
    expect(pushJob).toBeUndefined();
  });

  it("messages category OFF suppresses chat notifications entirely", async () => {
    mockGetPreferences.mockResolvedValue({ ...ALL_TRUE_PREFS, messages: false });
    await notifyFromEvent(burst);
    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
    expect(mockBumpMessageDigest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Onboarding flow additions (Henry's flow)
// ---------------------------------------------------------------------------

describe("notifyFromEvent — onboarding flow", () => {
  it("case.created → notifies the case's asesora (sales)", async () => {
    await notifyFromEvent({
      type: "case.created",
      payload: { caseId: CASE_ID },
      occurredAt: new Date(),
    });
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(1);
    const [input] = mockInsertNotificationIdempotent.mock.calls[0];
    expect(input.userId).toBe(SALES_USER_ID);
    expect(input.type).toBe("case.created");
    // Deep link must hit the real ventas case route (/ventas/clientes/, not /ventas/casos/).
    expect(input.actionUrl).toBe(`/ventas/clientes/${CASE_ID}`);
  });

  it("case.created (isFirstCase) → welcome email to the client + sales in-app", async () => {
    mockFindUserById.mockResolvedValue({
      id: CLIENT_USER_ID,
      email: "client@example.com",
      emailBouncedAt: null,
      locale: "es",
      phoneE164: "+15551234567",
      fullName: "María González",
      kind: "client",
    });
    await notifyFromEvent({
      type: "case.created",
      payload: { caseId: CASE_ID, isFirstCase: true },
      occurredAt: new Date(),
    });
    // Sales in-app + client welcome (2 in-app rows).
    const clientRows = mockInsertNotificationIdempotent.mock.calls.filter(
      ([i]) => i.userId === CLIENT_USER_ID,
    );
    expect(clientRows).toHaveLength(1);
    expect(clientRows[0][0].type).toBe("case.created.welcome");

    const emailJob = mockEnqueueJob.mock.calls.find(([p]) => p.channel === "email");
    expect(emailJob).toBeDefined();
    expect(emailJob![0].templateKey).toBe("welcome");
    expect(emailJob![0].recipientEmail).toBe("client@example.com");
    expect(emailJob![0].emailData).toMatchObject({
      kind: "welcome",
      phone: "+15551234567",
      clientName: "María González",
    });
  });

  it("case.created (NOT first case) → no welcome email", async () => {
    await notifyFromEvent({
      type: "case.created",
      payload: { caseId: CASE_ID, isFirstCase: false },
      occurredAt: new Date(),
    });
    const clientRows = mockInsertNotificationIdempotent.mock.calls.filter(
      ([i]) => i.userId === CLIENT_USER_ID,
    );
    expect(clientRows).toHaveLength(0);
    const emailJobs = mockEnqueueJob.mock.calls.filter(([p]) => p.channel === "email");
    expect(emailJobs).toHaveLength(0);
  });

  it("contract.sent → in-app + push + contract-ready email to the client with /firma/{token}", async () => {
    mockFindUserById.mockResolvedValue({
      id: CLIENT_USER_ID,
      email: "client@example.com",
      emailBouncedAt: null,
      locale: "es",
      kind: "client",
    });
    await notifyFromEvent({
      type: "contract.sent",
      payload: { contractId: CONTRACT_ID, caseId: CASE_ID, signingToken: "tok-abc" },
      occurredAt: new Date(),
    });
    const [input] = mockInsertNotificationIdempotent.mock.calls[0];
    expect(input.userId).toBe(CLIENT_USER_ID);
    expect(input.actionUrl).toBe("/firma/tok-abc");
    // Find the email job by channel only, then assert its template + recipient so
    // the assertion is not tautological (a find-by-templateKey would always match).
    const emailJob = mockEnqueueJob.mock.calls.find(([p]) => p.channel === "email");
    expect(emailJob).toBeDefined();
    expect(emailJob![0].templateKey).toBe("contract-ready");
    expect(emailJob![0].recipientEmail).toBe("client@example.com");
    // Push is now enabled for the signing link (best-effort; delivered if subscribed).
    const pushJob = mockEnqueueJob.mock.calls.find(([p]) => p.channel === "push");
    expect(pushJob).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// installment.paid — the payment receipt is a transactional email that must be
// delivered even when the client turned payment_reminders OFF (unsuppressible),
// and carries the structured receipt (amount + remaining) as emailData.
// ---------------------------------------------------------------------------

describe("notifyFromEvent('installment.paid') — receipt", () => {
  const paidEvent = {
    type: "installment.paid" as const,
    payload: {
      caseId: CASE_ID,
      installmentId: "inst-2",
      paymentId: "00000000-0000-0000-0000-000000000099",
      number: 2,
      amountCents: 20000,
      method: "zelle",
      installmentCount: 6,
      paidCount: 2,
      remainingCount: 4,
      remainingAmountCents: 80000,
      nextDueDate: "2026-09-01",
      nextDueAmountCents: 20000,
      caseNumber: "U26-000007",
      autopay: false,
      cardLast4: null,
    },
    occurredAt: new Date(),
  };

  it("emails the client the receipt even with payment_reminders OFF (unsuppressible)", async () => {
    mockGetPreferences.mockResolvedValue({
      messages: true,
      appointment_reminders: true,
      payment_reminders: false, // client disabled reminders
      case_updates: true,
      channels: { inapp: true, push: true, email: true },
    });
    mockFindUserById.mockResolvedValue({
      id: CLIENT_USER_ID,
      email: "client@example.com",
      emailBouncedAt: null,
      locale: "es",
      phoneE164: "+15551234567",
      fullName: "María",
      kind: "client",
    });

    await notifyFromEvent(paidEvent);

    const emailJob = mockEnqueueJob.mock.calls.find(([p]) => p.channel === "email");
    expect(emailJob).toBeDefined();
    expect(emailJob![0].templateKey).toBe("installment-paid");
    expect(emailJob![0].emailData).toMatchObject({
      kind: "payment-receipt",
      amountCents: 20000,
      remainingCount: 4,
      caseNumber: "U26-000007",
    });
  });
});

// ---------------------------------------------------------------------------
// payment.proof_submitted — finance always; sales only for the DOWNPAYMENT
// proof (Henry 2026-07-02). Dedupe is per payment (a re-submitted proof after
// a rejection must re-notify).
// ---------------------------------------------------------------------------

describe("notifyFromEvent('payment.proof_submitted')", () => {
  const PAYMENT_ID = "00000000-0000-0000-0000-000000000042";
  const proofEvent = (over?: Record<string, unknown>) => ({
    type: "payment.proof_submitted" as const,
    payload: {
      caseId: CASE_ID,
      installmentId: "inst-1",
      paymentId: PAYMENT_ID,
      isDownpayment: true,
      amountCents: 30000,
      ...over,
    },
    occurredAt: new Date(),
  });

  it("downpayment proof → finance + the case's asesora (sales) + client ack", async () => {
    await notifyFromEvent(proofEvent());

    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(3);

    const salesCalls = mockInsertNotificationIdempotent.mock.calls.filter(
      ([i]) => i.userId === SALES_USER_ID,
    );
    expect(salesCalls).toHaveLength(1);
    expect(salesCalls[0][0].type).toBe("payment.proof_submitted.sales");
    // Deep link opens the case with the Pagos tab active
    expect(salesCalls[0][0].actionUrl).toBe(`/ventas/clientes/${CASE_ID}?tab=pagos`);
    // Per-payment dedupe (NOT per case)
    expect(salesCalls[0][0].dedupeKey).toBe(
      `payment.proof_submitted:${PAYMENT_ID}:${SALES_USER_ID}`,
    );

    const financeCalls = mockInsertNotificationIdempotent.mock.calls.filter(
      ([i]) => i.userId === FINANCE_USER_ID,
    );
    expect(financeCalls).toHaveLength(1);
    // Finance deep-links straight into the verify panel (?paymentId= opens it)
    expect(financeCalls[0][0].actionUrl).toBe(
      `/finanzas/pagos/caso/${CASE_ID}?paymentId=${PAYMENT_ID}`,
    );

    // Push for finance + sales (client ack is in-app only)
    const pushJobs = mockEnqueueJob.mock.calls.filter(([p]) => p.channel === "push");
    expect(pushJobs).toHaveLength(2);
  });

  it("non-downpayment proof → sales NOT notified (when predicate); finance still is", async () => {
    await notifyFromEvent(proofEvent({ isDownpayment: false }));

    const salesCalls = mockInsertNotificationIdempotent.mock.calls.filter(
      ([i]) => i.userId === SALES_USER_ID,
    );
    expect(salesCalls).toHaveLength(0);

    const financeCalls = mockInsertNotificationIdempotent.mock.calls.filter(
      ([i]) => i.userId === FINANCE_USER_ID,
    );
    expect(financeCalls).toHaveLength(1);
  });

  it("a second proof (new paymentId) re-notifies — dedupe key is per payment", async () => {
    await notifyFromEvent(proofEvent({ paymentId: "00000000-0000-0000-0000-000000000043" }));

    const financeCalls = mockInsertNotificationIdempotent.mock.calls.filter(
      ([i]) => i.userId === FINANCE_USER_ID,
    );
    expect(financeCalls[0][0].dedupeKey).toBe(
      `payment.proof_submitted:00000000-0000-0000-0000-000000000043:${FINANCE_USER_ID}`,
    );
  });

  it("payment_reminders OFF for the asesora suppresses her notification", async () => {
    mockGetPreferences.mockImplementation(async (userId: string) =>
      userId === SALES_USER_ID
        ? { ...ALL_TRUE_PREFS, payment_reminders: false }
        : ALL_TRUE_PREFS,
    );

    await notifyFromEvent(proofEvent());

    const salesCalls = mockInsertNotificationIdempotent.mock.calls.filter(
      ([i]) => i.userId === SALES_USER_ID,
    );
    expect(salesCalls).toHaveLength(0);

    const financeCalls = mockInsertNotificationIdempotent.mock.calls.filter(
      ([i]) => i.userId === FINANCE_USER_ID,
    );
    expect(financeCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Docs + forms: client uploads/submissions → the case's asesora (sales, ①②);
// staff approvals/rejections of forms → the client (①②③). Client-only guard.
// ---------------------------------------------------------------------------

describe("notifyFromEvent — document.uploaded / form_response.*", () => {
  const FORM_DEF_ID = "00000000-0000-0000-0000-000000000021";
  const RESPONSE_ID = "00000000-0000-0000-0000-000000000022";

  it("document.uploaded by a client → sales only, push + in-app, no email", async () => {
    await notifyFromEvent({
      type: "document.uploaded",
      payload: { caseId: CASE_ID, documentId: DOC_ID, uploadedByKind: "client" },
      occurredAt: new Date(),
    });
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(1);
    const [input] = mockInsertNotificationIdempotent.mock.calls[0];
    expect(input.userId).toBe(SALES_USER_ID);
    expect(input.type).toBe("document.uploaded");
    expect(input.actionUrl).toBe(`/ventas/clientes/${CASE_ID}?tab=documentos`);
    expect(mockEnqueueJob.mock.calls.filter(([p]) => p.channel === "push")).toHaveLength(1);
    expect(mockEnqueueJob.mock.calls.filter(([p]) => p.channel === "email")).toHaveLength(0);
  });

  it("document.uploaded by staff → no notification (when-guard: client uploads only)", async () => {
    await notifyFromEvent({
      type: "document.uploaded",
      payload: { caseId: CASE_ID, documentId: DOC_ID, uploadedByKind: "staff" },
      occurredAt: new Date(),
    });
    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
  });

  it("form_response.submitted by a client → sales, review deep link with formDefinitionId, no email", async () => {
    await notifyFromEvent({
      type: "form_response.submitted",
      payload: {
        caseId: CASE_ID,
        responseId: RESPONSE_ID,
        formDefinitionId: FORM_DEF_ID,
        partyId: null,
        submittedByKind: "client",
      },
      occurredAt: new Date(),
    });
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(1);
    const [input] = mockInsertNotificationIdempotent.mock.calls[0];
    expect(input.userId).toBe(SALES_USER_ID);
    expect(input.type).toBe("form_response.submitted");
    expect(input.actionUrl).toBe(`/ventas/clientes/${CASE_ID}/revisar/${FORM_DEF_ID}`);
    expect(mockEnqueueJob.mock.calls.filter(([p]) => p.channel === "email")).toHaveLength(0);
  });

  it("form_response.submitted by staff → no notification (when-guard: client submits only)", async () => {
    await notifyFromEvent({
      type: "form_response.submitted",
      payload: {
        caseId: CASE_ID,
        responseId: RESPONSE_ID,
        formDefinitionId: FORM_DEF_ID,
        partyId: null,
        submittedByKind: "staff",
      },
      occurredAt: new Date(),
    });
    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
  });

  it("form_response.approved → client, green, form-approved email", async () => {
    await notifyFromEvent({
      type: "form_response.approved",
      payload: { caseId: CASE_ID, responseId: RESPONSE_ID, formDefinitionId: FORM_DEF_ID, partyId: null },
      occurredAt: new Date(),
    });
    const [input] = mockInsertNotificationIdempotent.mock.calls[0];
    expect(input.userId).toBe(CLIENT_USER_ID);
    expect(input.type).toBe("form_response.approved");
    expect(input.color).toBe("green");
    const emailJob = mockEnqueueJob.mock.calls.find(
      ([p]) => p.channel === "email" && p.templateKey === "form-approved",
    );
    expect(emailJob).toBeDefined();
    expect(input.actionUrl).toBe(`/caso/${CASE_ID}/formulario/${FORM_DEF_ID}`);
  });

  it("form_response.rejected → client, amber (never red), form-rejected email", async () => {
    await notifyFromEvent({
      type: "form_response.rejected",
      payload: { caseId: CASE_ID, responseId: RESPONSE_ID, formDefinitionId: FORM_DEF_ID, partyId: null },
      occurredAt: new Date(),
    });
    const [input] = mockInsertNotificationIdempotent.mock.calls[0];
    expect(input.userId).toBe(CLIENT_USER_ID);
    expect(input.color).toBe("amber");
    const emailJob = mockEnqueueJob.mock.calls.find(
      ([p]) => p.channel === "email" && p.templateKey === "form-rejected",
    );
    expect(emailJob).toBeDefined();
  });
});
