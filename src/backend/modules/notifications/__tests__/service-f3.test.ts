/**
 * Notifications service — F3 matrix row tests.
 *
 * Tests the appointment.booked / appointment.cancelled / appointment.rescheduled
 * / appointment.completed / lead.created dispatcher rows added in F3.
 *
 * Mocks: repository (no I/O), QStash, logger.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock factories (must be declared before vi.mock calls)
// ---------------------------------------------------------------------------

const mockInsertNotificationIdempotent = vi.hoisted(() => vi.fn());
const mockFindStaffByRole = vi.hoisted(() => vi.fn());
const mockFindCaseClientMembers = vi.hoisted(() => vi.fn());
const mockFindCaseAssignedStaff = vi.hoisted(() => vi.fn());
const mockFindUserById = vi.hoisted(() => vi.fn());
const mockFindLeadAssignedStaff = vi.hoisted(() => vi.fn());
const mockEnqueueJob = vi.hoisted(() => vi.fn());
const mockGetPreferences = vi.hoisted(() => vi.fn());
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
  findLeadAssignedStaff: mockFindLeadAssignedStaff,
  getPreferences: mockGetPreferences,
  upsertPreferences: vi.fn().mockResolvedValue(undefined),
  findUnreadMessageDigest: vi.fn().mockResolvedValue(null),
  bumpMessageDigest: vi.fn().mockResolvedValue(undefined),
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

import { notifyFromEvent } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CASE_ID = "11111111-1111-4111-8111-111111111001";
const APPT_ID = "11111111-1111-4111-8111-111111111002";
const NEW_APPT_ID = "11111111-1111-4111-8111-111111111003";
const LEAD_ID = "11111111-1111-4111-8111-111111111004";
const STAFF_USER_ID = "11111111-1111-4111-8111-111111111010";
const CLIENT_USER_ID = "11111111-1111-4111-8111-111111111011";
const ASESORA_USER_ID = "11111111-1111-4111-8111-111111111012";
const NOTIF_ID = "11111111-1111-4111-8111-111111111099";

beforeEach(() => {
  vi.clearAllMocks();

  // Default: all preference categories + channels ON
  mockGetPreferences.mockResolvedValue(ALL_TRUE_PREFS);

  // Default: notification is newly created
  mockInsertNotificationIdempotent.mockResolvedValue({
    row: { id: NOTIF_ID },
    created: true,
  });

  // Default: enqueue succeeds
  mockEnqueueJob.mockResolvedValue({ messageId: "msg-f3" });

  // Default: user has email, not bounced
  mockFindUserById.mockResolvedValue({
    id: CLIENT_USER_ID,
    email: "client@example.com",
    emailBouncedAt: null,
    locale: "es",
    kind: "client",
  });

  mockFindLeadAssignedStaff.mockResolvedValue(ASESORA_USER_ID);
  mockFindStaffByRole.mockResolvedValue([]);
  mockFindCaseAssignedStaff.mockResolvedValue({ salesId: null, paralegalId: null });
  mockFindCaseClientMembers.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// appointment.booked
// ---------------------------------------------------------------------------

describe("notifyFromEvent('appointment.booked')", () => {
  const basePayload = {
    appointmentId: APPT_ID,
    caseId: CASE_ID,
    leadId: null,
    staffId: STAFF_USER_ID,
    clientUserId: CLIENT_USER_ID,
    startsAt: new Date(),
    kind: "video",
    sequenceNumber: 1,
    bookedBy: "staff" as const,
  };

  it("notifies client (①②③) and staff (①)", async () => {
    await notifyFromEvent({
      type: "appointment.booked",
      payload: basePayload,
      occurredAt: new Date(),
    });

    // Client rule + Staff rule = 2 inserts
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(2);

    const calledUserIds = mockInsertNotificationIdempotent.mock.calls.map(
      (c) => c[0].userId as string,
    );
    expect(calledUserIds).toContain(CLIENT_USER_ID);
    expect(calledUserIds).toContain(STAFF_USER_ID);
  });

  it("client notification uses type 'appointment.booked'", async () => {
    await notifyFromEvent({
      type: "appointment.booked",
      payload: basePayload,
      occurredAt: new Date(),
    });

    const clientCall = mockInsertNotificationIdempotent.mock.calls.find(
      (c) => c[0].userId === CLIENT_USER_ID,
    );
    expect(clientCall?.[0].type).toBe("appointment.booked");
  });

  it("enqueues email with appointment-booked template for client", async () => {
    await notifyFromEvent({
      type: "appointment.booked",
      payload: basePayload,
      occurredAt: new Date(),
    });

    const emailJobs = mockEnqueueJob.mock.calls.filter(
      (c) => c[0].channel === "email" && c[0].templateKey === "appointment-booked",
    );
    expect(emailJobs).toHaveLength(1);
  });

  it("staff rule enqueues NO email (in-app ① only)", async () => {
    mockFindUserById.mockImplementation(async (id: string) => ({
      id,
      email: `${id}@example.com`,
      emailBouncedAt: null,
      locale: "es",
      kind: id === CLIENT_USER_ID ? "client" : "staff",
    }));

    await notifyFromEvent({
      type: "appointment.booked",
      payload: basePayload,
      occurredAt: new Date(),
    });

    // Staff should not receive an email (channels.email = false for staff rule)
    // We identify staff email by checking recipientEmail contains STAFF_USER_ID
    const staffEmailJobs = mockEnqueueJob.mock.calls.filter(
      (c) =>
        c[0].channel === "email" &&
        typeof c[0].recipientEmail === "string" &&
        (c[0].recipientEmail as string).includes(STAFF_USER_ID),
    );
    expect(staffEmailJobs).toHaveLength(0);
  });

  it("action URL contains appointmentId", async () => {
    await notifyFromEvent({
      type: "appointment.booked",
      payload: basePayload,
      occurredAt: new Date(),
    });

    const clientCall = mockInsertNotificationIdempotent.mock.calls.find(
      (c) => c[0].userId === CLIENT_USER_ID,
    );
    expect(clientCall?.[0].actionUrl).toContain(APPT_ID);
  });

  it("is idempotent: no QStash enqueue when notification already exists", async () => {
    mockInsertNotificationIdempotent.mockResolvedValue({
      row: { id: NOTIF_ID },
      created: false,
    });

    await notifyFromEvent({
      type: "appointment.booked",
      payload: basePayload,
      occurredAt: new Date(),
    });

    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("no-op for client rule when clientUserId is null", async () => {
    await notifyFromEvent({
      type: "appointment.booked",
      payload: { ...basePayload, clientUserId: null },
      occurredAt: new Date(),
    });

    // Only staff notification (1 insert), no client
    const clientCalls = mockInsertNotificationIdempotent.mock.calls.filter(
      (c) => c[0].userId === CLIENT_USER_ID,
    );
    expect(clientCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// appointment.cancelled
// ---------------------------------------------------------------------------

describe("notifyFromEvent('appointment.cancelled')", () => {
  it("notifies staff counterpart when client cancels", async () => {
    await notifyFromEvent({
      type: "appointment.cancelled",
      payload: {
        appointmentId: APPT_ID,
        caseId: CASE_ID,
        staffId: STAFF_USER_ID,
        clientUserId: CLIENT_USER_ID,
        startsAt: new Date(),
        cancelledBy: "client",
        late: false,
        reason: "client unavailable",
      },
      occurredAt: new Date(),
    });

    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(1);
    expect(mockInsertNotificationIdempotent.mock.calls[0][0].userId).toBe(STAFF_USER_ID);
    expect(mockInsertNotificationIdempotent.mock.calls[0][0].type).toBe("appointment.cancelled");
  });

  it("notifies client counterpart when staff cancels", async () => {
    mockFindUserById.mockResolvedValue({
      id: CLIENT_USER_ID,
      email: "client@example.com",
      emailBouncedAt: null,
      locale: "es",
      kind: "client",
    });

    await notifyFromEvent({
      type: "appointment.cancelled",
      payload: {
        appointmentId: APPT_ID,
        caseId: CASE_ID,
        staffId: STAFF_USER_ID,
        clientUserId: CLIENT_USER_ID,
        startsAt: new Date(),
        cancelledBy: "staff",
        late: false,
        reason: "staff emergency",
      },
      occurredAt: new Date(),
    });

    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(1);
    expect(mockInsertNotificationIdempotent.mock.calls[0][0].userId).toBe(CLIENT_USER_ID);
  });

  it("uses amber color (correctable — RF-TRX-022)", async () => {
    await notifyFromEvent({
      type: "appointment.cancelled",
      payload: {
        appointmentId: APPT_ID,
        caseId: CASE_ID,
        staffId: STAFF_USER_ID,
        clientUserId: CLIENT_USER_ID,
        startsAt: new Date(),
        cancelledBy: "client",
        late: false,
        reason: "rescheduling",
      },
      occurredAt: new Date(),
    });

    expect(mockInsertNotificationIdempotent.mock.calls[0][0].color).toBe("amber"); // never red
  });

  it("enqueues appointment-cancelled email", async () => {
    await notifyFromEvent({
      type: "appointment.cancelled",
      payload: {
        appointmentId: APPT_ID,
        caseId: CASE_ID,
        staffId: STAFF_USER_ID,
        clientUserId: CLIENT_USER_ID,
        startsAt: new Date(),
        cancelledBy: "client",
        late: false,
        reason: "scheduling conflict",
      },
      occurredAt: new Date(),
    });

    const emailJobs = mockEnqueueJob.mock.calls.filter(
      (c) => c[0].channel === "email" && c[0].templateKey === "appointment-cancelled",
    );
    expect(emailJobs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// appointment.rescheduled
// ---------------------------------------------------------------------------

describe("notifyFromEvent('appointment.rescheduled')", () => {
  it("notifies client counterpart when staff reschedules", async () => {
    mockFindUserById.mockResolvedValue({
      id: CLIENT_USER_ID,
      email: "client@example.com",
      emailBouncedAt: null,
      locale: "es",
      kind: "client",
    });

    await notifyFromEvent({
      type: "appointment.rescheduled",
      payload: {
        oldAppointmentId: APPT_ID,
        newAppointmentId: NEW_APPT_ID,
        caseId: CASE_ID,
        leadId: null,
        staffId: STAFF_USER_ID,
        clientUserId: CLIENT_USER_ID,
        oldStartsAt: new Date(),
        newStartsAt: new Date(Date.now() + 86400000),
        rescheduledBy: "staff",
      },
      occurredAt: new Date(),
    });

    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(1);
    expect(mockInsertNotificationIdempotent.mock.calls[0][0].userId).toBe(CLIENT_USER_ID);
    expect(mockInsertNotificationIdempotent.mock.calls[0][0].type).toBe("appointment.rescheduled");
  });

  it("action URL uses newAppointmentId for the rescheduled appointment", async () => {
    mockFindUserById.mockResolvedValue({
      id: CLIENT_USER_ID,
      email: "client@example.com",
      emailBouncedAt: null,
      locale: "es",
      kind: "client",
    });

    await notifyFromEvent({
      type: "appointment.rescheduled",
      payload: {
        oldAppointmentId: APPT_ID,
        newAppointmentId: NEW_APPT_ID,
        caseId: CASE_ID,
        leadId: null,
        staffId: STAFF_USER_ID,
        clientUserId: CLIENT_USER_ID,
        oldStartsAt: new Date(),
        newStartsAt: new Date(Date.now() + 86400000),
        rescheduledBy: "staff",
      },
      occurredAt: new Date(),
    });

    const actionUrl = mockInsertNotificationIdempotent.mock.calls[0][0].actionUrl as string;
    expect(actionUrl).toContain(NEW_APPT_ID);
  });

  it("enqueues appointment-rescheduled email", async () => {
    mockFindUserById.mockResolvedValue({
      id: CLIENT_USER_ID,
      email: "client@example.com",
      emailBouncedAt: null,
      locale: "es",
      kind: "client",
    });

    await notifyFromEvent({
      type: "appointment.rescheduled",
      payload: {
        oldAppointmentId: APPT_ID,
        newAppointmentId: NEW_APPT_ID,
        caseId: CASE_ID,
        leadId: null,
        staffId: STAFF_USER_ID,
        clientUserId: CLIENT_USER_ID,
        oldStartsAt: new Date(),
        newStartsAt: new Date(Date.now() + 86400000),
        rescheduledBy: "staff",
      },
      occurredAt: new Date(),
    });

    const emailJobs = mockEnqueueJob.mock.calls.filter(
      (c) => c[0].channel === "email" && c[0].templateKey === "appointment-rescheduled",
    );
    expect(emailJobs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// appointment.completed — no-op per DOC-47 §4.3
// ---------------------------------------------------------------------------

describe("notifyFromEvent('appointment.completed')", () => {
  it("is a no-op (timeline + metrics only — no notifications per matrix)", async () => {
    await notifyFromEvent({
      type: "appointment.completed",
      payload: {
        appointmentId: APPT_ID,
        caseId: CASE_ID,
        leadId: null,
        servicePhaseId: null,
        staffId: STAFF_USER_ID,
        sequenceNumber: 1,
      },
      occurredAt: new Date(),
    });

    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// lead.created
// ---------------------------------------------------------------------------

describe("notifyFromEvent('lead.created')", () => {
  it("notifies the assigned asesora (①②)", async () => {
    mockFindUserById.mockResolvedValue({
      id: ASESORA_USER_ID,
      email: "asesora@example.com",
      emailBouncedAt: null,
      locale: "es",
      kind: "staff",
    });

    await notifyFromEvent({
      type: "lead.created",
      payload: {
        leadId: LEAD_ID,
        orgId: "11111111-1111-4111-8111-111111110000",
        assignedTo: ASESORA_USER_ID,
        source: "manual",
      },
      occurredAt: new Date(),
    });

    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(1);
    expect(mockInsertNotificationIdempotent.mock.calls[0][0].userId).toBe(ASESORA_USER_ID);
    expect(mockInsertNotificationIdempotent.mock.calls[0][0].type).toBe("lead.created");
  });

  it("action URL contains leadId deep link", async () => {
    mockFindUserById.mockResolvedValue({
      id: ASESORA_USER_ID,
      email: "asesora@example.com",
      emailBouncedAt: null,
      locale: "es",
      kind: "staff",
    });

    await notifyFromEvent({
      type: "lead.created",
      payload: {
        leadId: LEAD_ID,
        orgId: "11111111-1111-4111-8111-111111110000",
        assignedTo: ASESORA_USER_ID,
        source: "manual",
      },
      occurredAt: new Date(),
    });

    const actionUrl = mockInsertNotificationIdempotent.mock.calls[0][0].actionUrl as string;
    expect(actionUrl).toContain(LEAD_ID);
  });

  it("does NOT enqueue email (matrix: ①② only — no email for lead.created)", async () => {
    mockFindUserById.mockResolvedValue({
      id: ASESORA_USER_ID,
      email: "asesora@example.com",
      emailBouncedAt: null,
      locale: "es",
      kind: "staff",
    });

    await notifyFromEvent({
      type: "lead.created",
      payload: {
        leadId: LEAD_ID,
        orgId: "11111111-1111-4111-8111-111111110000",
        assignedTo: ASESORA_USER_ID,
        source: "manual",
      },
      occurredAt: new Date(),
    });

    const emailJobs = mockEnqueueJob.mock.calls.filter(
      (c) => c[0].channel === "email",
    );
    expect(emailJobs).toHaveLength(0);
  });

  it("no-op when no staff is assigned (assignedTo: null)", async () => {
    await notifyFromEvent({
      type: "lead.created",
      payload: {
        leadId: LEAD_ID,
        orgId: "11111111-1111-4111-8111-111111110000",
        assignedTo: null,
        source: "web",
      },
      occurredAt: new Date(),
    });

    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
  });
});
