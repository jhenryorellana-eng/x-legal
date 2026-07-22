/**
 * getProspectSlots — org-level slots for a lead/eval cita (no case). The slot
 * math (materializeSlots) is covered by domain.test.ts; here we lock the service
 * wiring: prospect duration drives materialization, modality is the org default
 * 'video', `staffTimezone` is the org office/global reference TZ, and
 * `viewerTimezone` is the requesting staff's own profile TZ (PRIMARY display).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetActiveRules = vi.hoisted(() => vi.fn());
const mockGetSettings = vi.hoisted(() => vi.fn());
const mockGetExceptionsInRange = vi.hoisted(() => vi.fn());
const mockFindBooked = vi.hoisted(() => vi.fn());
const mockMaterialize = vi.hoisted(() => vi.fn());

vi.mock("../repository.js", () => ({
  getActiveRules: mockGetActiveRules,
  getSettings: mockGetSettings,
  getExceptionsInRange: mockGetExceptionsInRange,
  findBookedForMaterialization: mockFindBooked,
  // Office/global reference TZ (the "Utah" secondary chip).
  getOfficeTimezone: vi.fn().mockResolvedValue("America/Denver"),
}));

// getUserTimezone (a local service fn) reads users.timezone via a chained query;
// the requesting staff's profile lives in America/Lima.
vi.mock("@/backend/platform/supabase", () => {
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: { timezone: "America/Lima" } })),
  };
  return {
    createServiceClient: vi.fn(() => builder),
    createServerClient: vi.fn(() => builder),
  };
});

// Keep every real domain export, stub only materializeSlots (its own math is
// tested in domain.test.ts).
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

import { getProspectSlots } from "../service";
import type { Actor } from "@/backend/platform/authz";

const STAFF: Actor = {
  userId: "11111111-1111-4111-8111-111111111001",
  orgId: "22222222-2222-4222-8222-222222222002",
  role: "sales",
  kind: "staff",
  permissions: new Map(),
};

beforeEach(() => {
  vi.clearAllMocks();
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
    videoLink: "https://zoom.test/x",
    remindersEnabled: true,
  });
  mockGetExceptionsInRange.mockResolvedValue([]);
  mockFindBooked.mockResolvedValue([]);
  mockMaterialize.mockReturnValue([
    { startUtc: new Date("2026-07-06T13:00:00Z"), endUtc: new Date("2026-07-06T14:00:00Z") },
  ]);
});

describe("getProspectSlots", () => {
  it("uses prospect duration, video modality, the office reference TZ and the viewer TZ", async () => {
    const res = await getProspectSlots(STAFF, {
      windowFromUtc: new Date("2026-07-01T00:00:00Z"),
      windowToUtc: new Date("2026-07-31T00:00:00Z"),
    });

    expect(res.durationMinutes).toBe(60);
    expect(res.kind).toBe("video");
    // staffTimezone = office/global reference (Utah), NOT the rule snapshot zone.
    expect(res.staffTimezone).toBe("America/Denver");
    // viewerTimezone = the requesting staff's own profile zone (PRIMARY display).
    expect(res.viewerTimezone).toBe("America/Lima");
    expect(res.slots).toHaveLength(1);
  });

  it("materializes with durationMin = prospect_duration_minutes", async () => {
    await getProspectSlots(STAFF, {
      windowFromUtc: new Date("2026-07-01T00:00:00Z"),
      windowToUtc: new Date("2026-07-31T00:00:00Z"),
    });
    expect(mockMaterialize).toHaveBeenCalledWith(expect.objectContaining({ durationMin: 60 }));
  });

  it("zeroes min_notice for staff so near-term slots are offered (staff manage the agenda)", async () => {
    // Org min_notice is 24h (see beforeEach). Prospect booking is staff-only, so
    // the picker must NOT clip the near-term window — materializeSlots receives
    // minNoticeHours: 0 regardless of the org's configured antelación mínima.
    await getProspectSlots(STAFF, {
      windowFromUtc: new Date("2026-07-01T00:00:00Z"),
      windowToUtc: new Date("2026-07-31T00:00:00Z"),
    });
    expect(mockMaterialize).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ minNoticeHours: 0, maxAdvanceDays: 30 }),
      }),
    );
  });
});
