/**
 * getAvailableSlots — per-case slot picker (shared by client self-booking and by
 * staff booking from /ventas/citas). The slot math (materializeSlots) is covered
 * by domain.test.ts; here we lock the ACTOR RULE for min_notice ("antelación
 * mínima"): it binds CLIENTS only. A staff picker must materialize with
 * minNoticeHours: 0 (staff manage the agenda and may offer near-term slots),
 * while a client picker keeps the org's configured min_notice.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetPhasePolicy = vi.hoisted(() => vi.fn());
const mockGetCaseOverride = vi.hoisted(() => vi.fn());
const mockGetAppointmentSchedule = vi.hoisted(() => vi.fn());
const mockGetCaseApptScheduleRows = vi.hoisted(() => vi.fn());
const mockCountPhaseAppointments = vi.hoisted(() => vi.fn());
const mockGetPhaseSequenceNumbers = vi.hoisted(() => vi.fn());
const mockGetActiveRules = vi.hoisted(() => vi.fn());
const mockGetSettings = vi.hoisted(() => vi.fn());
const mockGetExceptionsInRange = vi.hoisted(() => vi.fn());
const mockFindBooked = vi.hoisted(() => vi.fn());
const mockMaterialize = vi.hoisted(() => vi.fn());

vi.mock("../repository.js", () => ({
  getPhasePolicy: mockGetPhasePolicy,
  getCaseOverride: mockGetCaseOverride,
  getAppointmentSchedule: mockGetAppointmentSchedule,
  getCaseAppointmentScheduleRows: mockGetCaseApptScheduleRows,
  countPhaseAppointments: mockCountPhaseAppointments,
  getPhaseSequenceNumbers: mockGetPhaseSequenceNumbers,
  getActiveRules: mockGetActiveRules,
  getSettings: mockGetSettings,
  getExceptionsInRange: mockGetExceptionsInRange,
  findBookedForMaterialization: mockFindBooked,
  getOfficeTimezone: vi.fn().mockResolvedValue("America/Denver"),
}));

// Multi-table service client: `cases` → the case row (active, one seat left);
// `users` → the actor's timezone. Fresh builder per createServiceClient() call.
const CASE_ROW = {
  id: "55555555-5555-4555-8555-555555555001",
  status: "active",
  current_phase_id: "66666666-6666-4666-8666-666666666001",
  assigned_sales_id: "11111111-1111-4111-8111-111111111001",
  primary_client_id: "33333333-3333-4333-8333-333333333001",
  rebooking_blocked_until: null,
};

vi.mock("@/backend/platform/supabase", () => {
  const makeBuilder = () => {
    let table = "";
    const b: Record<string, unknown> = {
      from: vi.fn((t: string) => {
        table = t;
        return b;
      }),
      select: vi.fn(() => b),
      eq: vi.fn(() => b),
      order: vi.fn(() => b),
      limit: vi.fn(() => b),
      maybeSingle: vi.fn(() => {
        if (table === "cases") return Promise.resolve({ data: CASE_ROW });
        if (table === "users")
          return Promise.resolve({ data: { timezone: "America/Bogota", id: "11111111-1111-4111-8111-111111111001" } });
        return Promise.resolve({ data: null });
      }),
    };
    return b;
  };
  return {
    createServiceClient: vi.fn(() => makeBuilder()),
    createServerClient: vi.fn(() => makeBuilder()),
  };
});

// cases module is lazily imported by getCasesModule(); getCaseCore reads the
// cases table directly (via the mocked service client), so an empty module is fine.
vi.mock("@/backend/modules/cases", () => ({}));

vi.mock("../domain.js", async (importActual) => {
  const actual = await importActual<typeof import("../domain")>();
  return { ...actual, materializeSlots: mockMaterialize };
});

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn(),
  AuthzError: class AuthzError extends Error {},
  systemActor: { userId: "system", orgId: "org-system", role: "admin", kind: "staff" },
}));

vi.mock("@/backend/platform/events", () => ({ appEvents: { emit: vi.fn() } }));
vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getAvailableSlots } from "../service";
import type { Actor } from "@/backend/platform/authz";

const ORG_ID = "22222222-2222-4222-8222-222222222002";
const CASE_ID = "55555555-5555-4555-8555-555555555001";

const STAFF: Actor = {
  userId: "11111111-1111-4111-8111-111111111001",
  orgId: ORG_ID,
  role: "sales",
  kind: "staff",
  permissions: new Map(),
};

const CLIENT: Actor = {
  userId: "33333333-3333-4333-8333-333333333001",
  orgId: ORG_ID,
  role: null,
  kind: "client",
  permissions: new Map(),
};

const WINDOW = {
  windowFromUtc: new Date("2026-07-01T00:00:00Z"),
  windowToUtc: new Date("2026-07-31T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPhasePolicy.mockResolvedValue({ appointmentCount: 3, durationMinutes: 30, kind: "video" });
  mockGetCaseOverride.mockResolvedValue(null);
  mockGetAppointmentSchedule.mockResolvedValue([]);
  mockGetCaseApptScheduleRows.mockResolvedValue([]);
  mockCountPhaseAppointments.mockResolvedValue(0);
  mockGetPhaseSequenceNumbers.mockResolvedValue([]);
  mockGetActiveRules.mockResolvedValue([
    { weekday: 1, startLocal: "09:00", endLocal: "17:00", timezone: "America/New_York", isActive: true },
  ]);
  mockGetSettings.mockResolvedValue({
    minNoticeHours: 24,
    maxAdvanceDays: 30,
    bufferMinutes: 0,
    cancellationWindowHours: 24,
    rebookingPenaltyDays: 7,
    prospectDurationMinutes: 60,
    videoLink: null,
    remindersEnabled: true,
  });
  mockGetExceptionsInRange.mockResolvedValue([]);
  mockFindBooked.mockResolvedValue([]);
  mockMaterialize.mockReturnValue([
    { startUtc: new Date("2026-07-06T13:00:00Z"), endUtc: new Date("2026-07-06T14:00:00Z") },
  ]);
});

describe("getAvailableSlots — min_notice is a client-only constraint", () => {
  it("zeroes min_notice for STAFF (they may offer near-term slots)", async () => {
    await getAvailableSlots(STAFF, { caseId: CASE_ID, ...WINDOW });
    expect(mockMaterialize).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ minNoticeHours: 0, maxAdvanceDays: 30 }),
      }),
    );
  });

  it("keeps the configured min_notice for CLIENTS (the guard still binds them)", async () => {
    await getAvailableSlots(CLIENT, { caseId: CASE_ID, ...WINDOW });
    expect(mockMaterialize).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ minNoticeHours: 24, maxAdvanceDays: 30 }),
      }),
    );
  });
});
