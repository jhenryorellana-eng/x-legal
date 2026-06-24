/**
 * completeAppointment — objectives outcome persistence + event summary.
 *
 * Verifies the F-citas behavior: completing an appointment snapshots which
 * objectives were achieved onto the row (staff detail) and emits
 * appointment.completed with a high-level { total, achieved } summary so the
 * cases timeline can render a client-visible "X de Y" entry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindById = vi.hoisted(() => vi.fn());
const mockUpdateAppointment = vi.hoisted(() => vi.fn());

vi.mock("../repository.js", () => ({
  findById: mockFindById,
  updateAppointment: mockUpdateAppointment,
  getSettings: vi.fn().mockResolvedValue({}),
  getAppointmentSchedule: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn(),
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(() => ({})),
  createServerClient: vi.fn(() => ({})),
}));

const mockEmitAndWait = vi.hoisted(() => vi.fn());
vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), emitAndWait: mockEmitAndWait },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

import { completeAppointment } from "../service";
import type { Actor } from "@/backend/platform/authz";

const STAFF: Actor = {
  userId: "11111111-1111-4111-8111-111111111001",
  orgId: "22222222-2222-4222-8222-222222222002",
  role: "sales",
  kind: "staff",
  permissions: new Map(),
};

const APPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAST = new Date(Date.now() - 60 * 60 * 1000); // started 1h ago

function makeAppt(overrides: Record<string, unknown> = {}) {
  return {
    id: APPT_ID,
    org_id: STAFF.orgId,
    case_id: "case-uuid-0001-0000-0000-000000000000",
    lead_id: null,
    service_phase_id: "phase-1",
    staff_id: "staff-1",
    client_user_id: "client-1",
    starts_at: PAST.toISOString(),
    ends_at: new Date(PAST.getTime() + 30 * 60 * 1000).toISOString(),
    kind: "video",
    status: "scheduled",
    sequence_number: 1,
    notes: null,
    objectives_outcome: null,
    ...overrides,
  };
}

describe("completeAppointment — objectives outcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateAppointment.mockResolvedValue(undefined);
    mockEmitAndWait.mockResolvedValue(undefined);
  });

  it("persists the outcome and emits a { total, achieved } summary", async () => {
    mockFindById.mockResolvedValue(makeAppt());
    const outcome = [
      { id: "o1", text: "Bienvenida", achieved: true },
      { id: "o2", text: "Explicar proceso", achieved: false },
      { id: "o3", text: "Agendar siguiente", achieved: true },
    ];

    await completeAppointment(STAFF, { appointmentId: APPT_ID, objectivesOutcome: outcome, notes: "ok" });

    expect(mockUpdateAppointment).toHaveBeenCalledWith(
      APPT_ID,
      expect.objectContaining({ status: "completed", objectivesOutcome: outcome }),
    );
    expect(mockEmitAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "appointment.completed",
        payload: expect.objectContaining({ objectivesSummary: { total: 3, achieved: 2 } }),
      }),
    );
  });

  it("emits a null summary when no objectives were recorded", async () => {
    mockFindById.mockResolvedValue(makeAppt());

    await completeAppointment(STAFF, { appointmentId: APPT_ID });

    expect(mockUpdateAppointment).toHaveBeenCalledWith(
      APPT_ID,
      expect.objectContaining({ status: "completed", objectivesOutcome: null }),
    );
    expect(mockEmitAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ objectivesSummary: null }),
      }),
    );
  });

  it("rejects when the appointment has not started yet", async () => {
    mockFindById.mockResolvedValue(
      makeAppt({ starts_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() }),
    );

    await expect(
      completeAppointment(STAFF, { appointmentId: APPT_ID }),
    ).rejects.toMatchObject({ code: "APPT_NOT_STARTED" });
    expect(mockUpdateAppointment).not.toHaveBeenCalled();
  });
});
