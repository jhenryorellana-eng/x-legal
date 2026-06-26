/**
 * getProspectSlots — org-level slots for a lead/eval cita (no case). The slot
 * math (materializeSlots) is covered by domain.test.ts; here we lock the service
 * wiring: prospect duration drives materialization, modality is the org default
 * 'video', and the agenda timezone comes from the org rules.
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
}));

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

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(() => ({})),
  createServerClient: vi.fn(() => ({})),
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
  it("uses prospect duration, video modality and the org rule timezone", async () => {
    const res = await getProspectSlots(STAFF, {
      windowFromUtc: new Date("2026-07-01T00:00:00Z"),
      windowToUtc: new Date("2026-07-31T00:00:00Z"),
    });

    expect(res.durationMinutes).toBe(60);
    expect(res.kind).toBe("video");
    expect(res.staffTimezone).toBe("America/New_York");
    expect(res.slots).toHaveLength(1);
  });

  it("materializes with durationMin = prospect_duration_minutes", async () => {
    await getProspectSlots(STAFF, {
      windowFromUtc: new Date("2026-07-01T00:00:00Z"),
      windowToUtc: new Date("2026-07-31T00:00:00Z"),
    });
    expect(mockMaterialize).toHaveBeenCalledWith(expect.objectContaining({ durationMin: 60 }));
  });
});
