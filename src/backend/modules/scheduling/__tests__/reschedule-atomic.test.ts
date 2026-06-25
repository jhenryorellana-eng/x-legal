/**
 * C-1 (revised): rescheduleAppointment atomicity + uniqueness invariant (TDD).
 *
 * The partial unique index appointments_case_phase_seq_unique_idx forbids two
 * rows sharing (case_id, service_phase_id, sequence_number) while both are
 * 'scheduled'/'completed'. The new cita inherits the old seq, so the old slot
 * must be FREED before inserting. The flow is therefore "free-first, compensate
 * on failure":
 *   - Step 1 marks the old cita 'rescheduled' (leaves the unique scope).
 *   - Step 2 inserts the new cita; if it fails, the old cita is rolled back to
 *     'scheduled' so the case is never silently orphaned.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockInsertAppointment = vi.hoisted(() => vi.fn());
const mockUpdateAppointment = vi.hoisted(() => vi.fn());
const mockFindById = vi.hoisted(() => vi.fn());
const mockGetSettings = vi.hoisted(() => vi.fn());
const mockGetActiveRules = vi.hoisted(() => vi.fn());
const mockGetExceptionsInRange = vi.hoisted(() => vi.fn());
const mockFindBookedForMaterialization = vi.hoisted(() => vi.fn());
const mockGetUserTimezone = vi.hoisted(() => vi.fn());
const mockFindOrgAppointmentsInRange = vi.hoisted(() => vi.fn());

vi.mock("../repository.js", () => ({
  findById: mockFindById,
  insertAppointment: mockInsertAppointment,
  updateAppointment: mockUpdateAppointment,
  getSettings: mockGetSettings,
  getActiveRules: mockGetActiveRules,
  getExceptionsInRange: mockGetExceptionsInRange,
  findBookedForMaterialization: mockFindBookedForMaterialization,
  getUserTimezone: mockGetUserTimezone,
  findOrgAppointmentsInRange: mockFindOrgAppointmentsInRange,
  // Other repo fns used transitively — stub as no-ops
  findBookedInRange: vi.fn().mockResolvedValue([]),
  findDueReminders: vi.fn().mockResolvedValue([]),
  markReminderSent: vi.fn().mockResolvedValue(true),
  findStaffException: vi.fn().mockResolvedValue(null),
  getExceptionById: vi.fn().mockResolvedValue(null),
  insertException: vi.fn().mockResolvedValue({}),
  deleteException: vi.fn().mockResolvedValue(undefined),
  saveRules: vi.fn().mockResolvedValue([]),
  upsertSettings: vi.fn().mockResolvedValue({}),
  setRebookingBlockedUntil: vi.fn().mockResolvedValue(undefined),
  getRebookingBlockedUntil: vi.fn().mockResolvedValue(null),
  getPhasePolicy: vi.fn().mockResolvedValue(null),
  getCaseOverride: vi.fn().mockResolvedValue(null),
  getPhaseSequenceNumbers: vi.fn().mockResolvedValue([]),
  getAllRules: vi.fn().mockResolvedValue([]),
  saveRulesForStaff: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn(),
  systemActor: { userId: "system", orgId: "org-system", role: "admin", kind: "staff" },
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(() => ({})),
  createServerClient: vi.fn(() => ({})),
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), emitAndWait: vi.fn() },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks
import { rescheduleAppointment } from "../service";
import type { Actor } from "@/backend/platform/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STAFF_ACTOR: Actor = {
  userId:      "11111111-1111-4111-8111-111111111001",
  orgId:       "22222222-2222-4222-8222-222222222002",
  role:        "sales",
  kind:        "staff",
  permissions: new Map(),
};

const OLD_APPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW_APPT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STAFF_ID    = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLIENT_ID   = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// Relative to "now" so the appointment is always in the future (within the
// 90-day advance window) — a hardcoded absolute date becomes a time-bomb that
// trips the APPT_ALREADY_STARTED guard once the wall clock passes it.
const _DAY_MS = 24 * 60 * 60 * 1000;
const OLD_STARTS = new Date(Date.now() + 2 * _DAY_MS);
const OLD_ENDS   = new Date(OLD_STARTS.getTime() + 30 * 60 * 1000);
const NEW_STARTS = new Date(Date.now() + 3 * _DAY_MS);

function makeOldAppt(overrides: Record<string, unknown> = {}) {
  return {
    id: OLD_APPT_ID,
    org_id: STAFF_ACTOR.orgId,
    case_id: "case-uuid-0001-0000-0000-000000000000",
    lead_id: null,
    service_phase_id: null,
    staff_id: STAFF_ID,
    client_user_id: CLIENT_ID,
    starts_at: OLD_STARTS.toISOString(),
    ends_at: OLD_ENDS.toISOString(),
    kind: "video",
    status: "scheduled",
    sequence_number: 1,
    reminder_1d: true,
    reminder_1h: true,
    notes: null,
    livekit_room_id: null,
    reminder_1d_sent_at: null,
    reminder_1h_sent_at: null,
    rebooking_blocked_until: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: OLD_STARTS.toISOString(),
    updated_at: OLD_STARTS.toISOString(),
    ...overrides,
  };
}

function makeSettings() {
  return {
    staff_id: STAFF_ID,
    min_notice_hours: 0,
    max_advance_days: 90,
    buffer_minutes: 0,
    cancellation_window_hours: 24,
    rebooking_penalty_days: 7,
    created_at: "",
    updated_at: "",
  };
}

// ---------------------------------------------------------------------------
// C-1: insert-first ordering — insert fails → old stays 'scheduled'
// ---------------------------------------------------------------------------

describe("C-1: rescheduleAppointment — free-first + compensation invariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue(makeSettings());
    // Default: appointment not found (tests override as needed)
    mockFindById.mockResolvedValue(null);
    mockUpdateAppointment.mockResolvedValue({});
  });

  it("rolls the old cita back to 'scheduled' when insert throws SLOT_TAKEN_DB", async () => {
    // Arrange: staff reschedule (no slot availability check)
    mockFindById.mockResolvedValue(makeOldAppt());
    const slotTakenErr = Object.assign(new Error("SLOT_TAKEN_DB"), { code: "SLOT_TAKEN_DB" });
    mockInsertAppointment.mockRejectedValue(slotTakenErr);

    // Act
    await expect(
      rescheduleAppointment(STAFF_ACTOR, {
        appointmentId: OLD_APPT_ID,
        newStartsAtUtc: NEW_STARTS,
      }),
    ).rejects.toMatchObject({ code: "SLOT_TAKEN" });

    // Slot freed first (rescheduled), then compensated back to scheduled.
    expect(mockUpdateAppointment).toHaveBeenCalledWith(
      OLD_APPT_ID,
      expect.objectContaining({ status: "rescheduled" }),
    );
    const oldCalls = mockUpdateAppointment.mock.calls.filter((args: unknown[]) => args[0] === OLD_APPT_ID);
    expect((oldCalls.at(-1)?.[1] as { status?: string }).status).toBe("scheduled");
  });

  it("rolls the old cita back to 'scheduled' when insert throws a generic DB error", async () => {
    mockFindById.mockResolvedValue(makeOldAppt());
    mockInsertAppointment.mockRejectedValue(new Error("connection refused"));

    await expect(
      rescheduleAppointment(STAFF_ACTOR, {
        appointmentId: OLD_APPT_ID,
        newStartsAtUtc: NEW_STARTS,
      }),
    ).rejects.toThrow("connection refused");

    // Final state for the old cita is 'scheduled' (compensated).
    const oldCalls = mockUpdateAppointment.mock.calls.filter((args: unknown[]) => args[0] === OLD_APPT_ID);
    expect((oldCalls.at(-1)?.[1] as { status?: string }).status).toBe("scheduled");
  });

  it("frees the old cita's slot BEFORE inserting and leaves it 'rescheduled' on success", async () => {
    const newApptRow = makeOldAppt({
      id: NEW_APPT_ID,
      starts_at: NEW_STARTS.toISOString(),
      ends_at: new Date(NEW_STARTS.getTime() + 30 * 60 * 1000).toISOString(),
      status: "scheduled",
    });
    mockFindById.mockResolvedValue(makeOldAppt());
    mockInsertAppointment.mockResolvedValue(newApptRow);
    mockUpdateAppointment.mockResolvedValue({});

    await rescheduleAppointment(STAFF_ACTOR, {
      appointmentId: OLD_APPT_ID,
      newStartsAtUtc: NEW_STARTS,
    });

    // The old cita is freed (rescheduled) BEFORE the insert runs.
    const firstUpdateOrder = mockUpdateAppointment.mock.invocationCallOrder[0];
    const insertOrder = mockInsertAppointment.mock.invocationCallOrder[0];
    expect(firstUpdateOrder).toBeLessThan(insertOrder);
    expect(mockUpdateAppointment).toHaveBeenCalledWith(
      OLD_APPT_ID,
      expect.objectContaining({ status: "rescheduled" }),
    );

    // On success there is NO compensation: the old cita is never set back to scheduled.
    const revertCalls = mockUpdateAppointment.mock.calls.filter(
      (args: unknown[]) => args[0] === OLD_APPT_ID && (args[1] as { status?: string }).status === "scheduled",
    );
    expect(revertCalls).toHaveLength(0);
  });

  it("no silent orphan: insert failure ends with the old cita restored to 'scheduled'", async () => {
    mockFindById.mockResolvedValue(makeOldAppt());
    mockInsertAppointment.mockRejectedValue(new Error("some db error"));

    try {
      await rescheduleAppointment(STAFF_ACTOR, {
        appointmentId: OLD_APPT_ID,
        newStartsAtUtc: NEW_STARTS,
      });
    } catch {
      // expected
    }

    // The old cita is freed then restored → its FINAL status is 'scheduled'.
    const oldCalls = mockUpdateAppointment.mock.calls.filter((args: unknown[]) => args[0] === OLD_APPT_ID);
    expect(oldCalls.length).toBeGreaterThanOrEqual(2);
    expect((oldCalls.at(-1)?.[1] as { status?: string }).status).toBe("scheduled");
  });
});
