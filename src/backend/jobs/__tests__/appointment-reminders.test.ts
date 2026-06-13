/**
 * Job: appointment-reminders — TDD tests.
 *
 * Covers:
 * - Window calculation (24h and 1h windows based on `now`)
 * - Correct calls to findDueReminders with proper window boundaries
 * - Notification insertion per recipient (client + staff)
 * - markReminderSent called after dispatch (idempotency mark)
 * - No double-notifying on re-delivery (insertNotificationIdempotent created=false)
 * - Email enqueued for recipients with valid email
 * - No email when user has no email / email bounced
 * - Invalid payload returns without throwing (non-retriable)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------

const mockFindDueReminders = vi.hoisted(() => vi.fn());
const mockMarkReminderSent = vi.hoisted(() => vi.fn());
const mockInsertNotificationIdempotent = vi.hoisted(() => vi.fn());
const mockFindUserById = vi.hoisted(() => vi.fn());
const mockEnqueueJob = vi.hoisted(() => vi.fn());

vi.mock("@/backend/modules/scheduling", () => ({
  findDueReminders: mockFindDueReminders,
  markReminderSent: mockMarkReminderSent,
}));

vi.mock("@/backend/modules/notifications", () => ({
  insertNotificationIdempotent: mockInsertNotificationIdempotent,
  findUserById: mockFindUserById,
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

import { handleAppointmentReminders } from "../appointment-reminders";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const APPT_ID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APPT_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CASE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STAFF_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLIENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NOTIF_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const VALID_PAYLOAD = {
  jobKey: "appointment-reminders",
  entityId: null,
  attempt: 1,
  dedupeId: "appointment-reminders:2026-06-13T14:15",
};

function makeReminderRow(id: string) {
  return {
    id,
    caseId: CASE_ID,
    leadId: null,
    staffId: STAFF_ID,
    clientUserId: CLIENT_ID,
    startsAt: new Date(),
    kind: "video",
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: no appointments due
  mockFindDueReminders.mockResolvedValue([]);
  mockMarkReminderSent.mockResolvedValue(true);

  // Default: notification newly created
  mockInsertNotificationIdempotent.mockResolvedValue({
    row: { id: NOTIF_ID },
    created: true,
  });

  // Default: user has email, no bounce
  mockFindUserById.mockResolvedValue({
    id: CLIENT_ID,
    email: "client@example.com",
    emailBouncedAt: null,
    locale: "es",
    kind: "client",
  });

  mockEnqueueJob.mockResolvedValue({ messageId: "msg-reminder" });
});

// ---------------------------------------------------------------------------
// Window calculation
// ---------------------------------------------------------------------------

describe("buildWindows — reminder window boundaries", () => {
  it("calls findDueReminders for both 1d and 1h kinds", async () => {
    await handleAppointmentReminders(VALID_PAYLOAD);

    // Should be called twice: once for "1d", once for "1h"
    expect(mockFindDueReminders).toHaveBeenCalledTimes(2);
    const kinds = mockFindDueReminders.mock.calls.map((c) => c[0] as string);
    expect(kinds).toContain("1d");
    expect(kinds).toContain("1h");
  });

  it("1d window: start ~= now+24h-15min, end ~= now+24h", async () => {
    const beforeCall = Date.now();
    await handleAppointmentReminders(VALID_PAYLOAD);
    const afterCall = Date.now();

    const h24Call = mockFindDueReminders.mock.calls.find(
      (c) => c[0] === "1d",
    );
    expect(h24Call).toBeDefined();
    const windowStart = h24Call![1] as Date;
    const windowEnd = h24Call![2] as Date;

    const h24Ms = 24 * 60 * 60 * 1000;
    const h15min = 15 * 60 * 1000;

    // windowEnd should be ~now+24h (within 1 second of call time)
    expect(windowEnd.getTime()).toBeGreaterThanOrEqual(beforeCall + h24Ms - 1000);
    expect(windowEnd.getTime()).toBeLessThanOrEqual(afterCall + h24Ms + 1000);

    // windowStart should be windowEnd - 15min
    expect(windowEnd.getTime() - windowStart.getTime()).toBeCloseTo(h15min, -2);
  });

  it("1h window: start ~= now+1h-15min, end ~= now+1h", async () => {
    const beforeCall = Date.now();
    await handleAppointmentReminders(VALID_PAYLOAD);
    const afterCall = Date.now();

    const h1Call = mockFindDueReminders.mock.calls.find(
      (c) => c[0] === "1h",
    );
    expect(h1Call).toBeDefined();
    const windowStart = h1Call![1] as Date;
    const windowEnd = h1Call![2] as Date;

    const h1Ms = 60 * 60 * 1000;
    const h15min = 15 * 60 * 1000;

    expect(windowEnd.getTime()).toBeGreaterThanOrEqual(beforeCall + h1Ms - 1000);
    expect(windowEnd.getTime()).toBeLessThanOrEqual(afterCall + h1Ms + 1000);
    expect(windowEnd.getTime() - windowStart.getTime()).toBeCloseTo(h15min, -2);
  });
});

// ---------------------------------------------------------------------------
// Notification dispatch
// ---------------------------------------------------------------------------

describe("handleAppointmentReminders — notification dispatch", () => {
  it("inserts in-app notification for client when 1d reminder is due", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1d") return [makeReminderRow(APPT_ID_1)];
      return [];
    });

    await handleAppointmentReminders(VALID_PAYLOAD);

    const clientInserts = mockInsertNotificationIdempotent.mock.calls.filter(
      (c) => c[0].userId === CLIENT_ID && c[0].type === "appointment.reminder_1d",
    );
    expect(clientInserts).toHaveLength(1);
  });

  it("inserts in-app notification for staff as well", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1d") return [makeReminderRow(APPT_ID_1)];
      return [];
    });

    await handleAppointmentReminders(VALID_PAYLOAD);

    const staffInserts = mockInsertNotificationIdempotent.mock.calls.filter(
      (c) => c[0].userId === STAFF_ID && c[0].type === "appointment.reminder_1d",
    );
    expect(staffInserts).toHaveLength(1);
  });

  it("uses correct notification type for 1h reminder", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1h") return [makeReminderRow(APPT_ID_1)];
      return [];
    });

    await handleAppointmentReminders(VALID_PAYLOAD);

    const h1Inserts = mockInsertNotificationIdempotent.mock.calls.filter(
      (c) => c[0].type === "appointment.reminder_1h",
    );
    expect(h1Inserts.length).toBeGreaterThanOrEqual(1);
  });

  it("enqueues email deliver-notification with appointment-24h template for 1d", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1d") return [makeReminderRow(APPT_ID_1)];
      return [];
    });
    mockFindUserById.mockResolvedValue({
      id: CLIENT_ID,
      email: "client@example.com",
      emailBouncedAt: null,
      locale: "es",
      kind: "client",
    });

    await handleAppointmentReminders(VALID_PAYLOAD);

    const emailJobs = mockEnqueueJob.mock.calls.filter(
      (c) => c[0].channel === "email" && c[0].templateKey === "appointment-24h",
    );
    expect(emailJobs.length).toBeGreaterThanOrEqual(1);
  });

  it("enqueues email with appointment-1h template for 1h", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1h") return [makeReminderRow(APPT_ID_1)];
      return [];
    });
    mockFindUserById.mockResolvedValue({
      id: CLIENT_ID,
      email: "client@example.com",
      emailBouncedAt: null,
      locale: "es",
      kind: "client",
    });

    await handleAppointmentReminders(VALID_PAYLOAD);

    const emailJobs = mockEnqueueJob.mock.calls.filter(
      (c) => c[0].channel === "email" && c[0].templateKey === "appointment-1h",
    );
    expect(emailJobs.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT enqueue email when user has no email", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1d") return [makeReminderRow(APPT_ID_1)];
      return [];
    });
    mockFindUserById.mockResolvedValue({
      id: CLIENT_ID,
      email: null,
      emailBouncedAt: null,
      locale: "es",
      kind: "client",
    });

    await handleAppointmentReminders(VALID_PAYLOAD);

    const emailJobs = mockEnqueueJob.mock.calls.filter(
      (c) => c[0].channel === "email",
    );
    expect(emailJobs).toHaveLength(0);
  });

  it("does NOT enqueue email when email has bounced", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1d") return [makeReminderRow(APPT_ID_1)];
      return [];
    });
    mockFindUserById.mockResolvedValue({
      id: CLIENT_ID,
      email: "client@example.com",
      emailBouncedAt: "2026-01-01T00:00:00Z",
      locale: "es",
      kind: "client",
    });

    await handleAppointmentReminders(VALID_PAYLOAD);

    const emailJobs = mockEnqueueJob.mock.calls.filter(
      (c) => c[0].channel === "email",
    );
    expect(emailJobs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("handleAppointmentReminders — idempotency", () => {
  it("calls markReminderSent for each processed appointment", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1d") return [makeReminderRow(APPT_ID_1)];
      return [];
    });

    await handleAppointmentReminders(VALID_PAYLOAD);

    expect(mockMarkReminderSent).toHaveBeenCalledWith(APPT_ID_1, "1d");
  });

  it("does NOT enqueue QStash on re-delivery (created=false)", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1d") return [makeReminderRow(APPT_ID_1)];
      return [];
    });
    // Simulate notification already exists
    mockInsertNotificationIdempotent.mockResolvedValue({
      row: { id: NOTIF_ID },
      created: false,
    });

    await handleAppointmentReminders(VALID_PAYLOAD);

    // Even if re-delivered, no QStash enqueue (created=false path)
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("processes multiple appointments independently", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1d")
        return [makeReminderRow(APPT_ID_1), makeReminderRow(APPT_ID_2)];
      return [];
    });

    await handleAppointmentReminders(VALID_PAYLOAD);

    expect(mockMarkReminderSent).toHaveBeenCalledWith(APPT_ID_1, "1d");
    expect(mockMarkReminderSent).toHaveBeenCalledWith(APPT_ID_2, "1d");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("handleAppointmentReminders — edge cases", () => {
  it("invalid payload returns without throwing (non-retriable schema error)", async () => {
    await expect(
      handleAppointmentReminders({ invalid: true }),
    ).resolves.toBeUndefined();

    expect(mockFindDueReminders).not.toHaveBeenCalled();
  });

  it("no-op when no appointments are due in either window", async () => {
    mockFindDueReminders.mockResolvedValue([]);

    await handleAppointmentReminders(VALID_PAYLOAD);

    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
    expect(mockMarkReminderSent).not.toHaveBeenCalled();
  });

  it("skips appointment with no clientUserId and no staffId gracefully", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1h")
        return [
          {
            id: APPT_ID_1,
            caseId: null,
            leadId: null,
            staffId: null as unknown as string,
            clientUserId: null,
            startsAt: new Date(),
            kind: "phone",
          },
        ];
      return [];
    });

    // Should not throw; just skip recipients
    await expect(
      handleAppointmentReminders(VALID_PAYLOAD),
    ).resolves.toBeUndefined();

    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// H-4: mark-before-enqueue ordering — no double-email on cron re-delivery
// ---------------------------------------------------------------------------

describe("H-4: mark-before-enqueue ordering", () => {
  it("calls markReminderSent BEFORE dispatchReminderNotifications (enqueueJob)", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1d") return [makeReminderRow(APPT_ID_1)];
      return [];
    });

    const callOrder: string[] = [];
    mockMarkReminderSent.mockImplementation(async () => {
      callOrder.push("markReminderSent");
      return true;
    });
    mockInsertNotificationIdempotent.mockImplementation(async () => {
      callOrder.push("insertNotification");
      return { row: { id: NOTIF_ID }, created: true };
    });
    mockEnqueueJob.mockImplementation(async () => {
      callOrder.push("enqueueJob");
      return { messageId: "msg-1" };
    });

    await handleAppointmentReminders(VALID_PAYLOAD);

    const markIdx = callOrder.indexOf("markReminderSent");
    const enqueueIdx = callOrder.indexOf("enqueueJob");
    expect(markIdx).toBeGreaterThanOrEqual(0);
    expect(enqueueIdx).toBeGreaterThanOrEqual(0);
    // markReminderSent must come before the first enqueueJob
    expect(markIdx).toBeLessThan(enqueueIdx);
  });

  it("skips dispatch entirely when markReminderSent returns false (already marked by concurrent run)", async () => {
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1d") return [makeReminderRow(APPT_ID_1)];
      return [];
    });
    // Simulate: already marked by a concurrent cron invocation
    mockMarkReminderSent.mockResolvedValue(false);

    await handleAppointmentReminders(VALID_PAYLOAD);

    // No notifications sent, no emails enqueued
    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("double-delivery safe: if markReminderSent already ran, skip avoids duplicate email", async () => {
    // Simulate cron running twice for the same window
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1d") return [makeReminderRow(APPT_ID_1)];
      return [];
    });

    // First invocation: marks sent
    mockMarkReminderSent.mockResolvedValueOnce(true);
    await handleAppointmentReminders(VALID_PAYLOAD);
    const firstEnqueues = mockEnqueueJob.mock.calls.length;

    vi.clearAllMocks();
    mockFindDueReminders.mockImplementation(async (kind: string) => {
      if (kind === "1d") return [makeReminderRow(APPT_ID_1)];
      return [];
    });

    // Second invocation: already marked → returns false
    mockMarkReminderSent.mockResolvedValueOnce(false);
    await handleAppointmentReminders(VALID_PAYLOAD);
    const secondEnqueues = mockEnqueueJob.mock.calls.length;

    expect(firstEnqueues).toBeGreaterThan(0); // first run sent notifications
    expect(secondEnqueues).toBe(0);           // second run skipped entirely
  });
});
