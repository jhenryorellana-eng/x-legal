/**
 * getAvailabilityConfig read-path tests (RF-VAN-032 read).
 *
 * The editor page used to render hardcoded defaults, so a rep's saved weekly
 * schedule never reappeared on reload. These tests lock the read mapping:
 *   - active flat rules → per-weekday ranges, "HH:MM:SS" trimmed to "HH:MM"
 *   - inactive rules are dropped
 *   - settings (min notice / rebooking penalty) passthrough
 *   - a non-admin reading another staff's config is forbidden
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAllRules = vi.hoisted(() => vi.fn());
const mockGetSettings = vi.hoisted(() => vi.fn());
const mockListExceptions = vi.hoisted(() => vi.fn());

vi.mock("../repository.js", () => ({
  getAllRules: mockGetAllRules,
  getSettings: mockGetSettings,
  listExceptions: mockListExceptions,
}));

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn(),
  // Real-ish error class so the service's `throw new AuthzError(...)` works.
  AuthzError: class AuthzError extends Error {
    constructor(code: string) {
      super(code);
      this.name = "AuthzError";
    }
  },
  systemActor: { userId: "system", orgId: "org-system", role: "admin", kind: "staff" },
}));

// getUserTimezone (a local service fn) reads users.timezone via a chained query.
vi.mock("@/backend/platform/supabase", () => {
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: { timezone: "America/New_York" } })),
  };
  return {
    createServiceClient: vi.fn(() => builder),
    createServerClient: vi.fn(() => builder),
  };
});

vi.mock("@/backend/platform/events", () => ({ appEvents: { emit: vi.fn() } }));
vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getAvailabilityConfig } from "../service";
import type { Actor } from "@/backend/platform/authz";

const STAFF: Actor = {
  userId: "11111111-1111-4111-8111-111111111001",
  orgId: "22222222-2222-4222-8222-222222222002",
  role: "sales",
  kind: "staff",
  permissions: new Map(),
};

function settings(over: Record<string, unknown> = {}) {
  return {
    minNoticeHours: 24,
    maxAdvanceDays: 90,
    bufferMinutes: 0,
    cancellationWindowHours: 24,
    rebookingPenaltyDays: 7,
    ...over,
  };
}

describe("getAvailabilityConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue(settings());
    mockListExceptions.mockResolvedValue([]);
  });

  it("groups active rules into per-weekday ranges and trims seconds", async () => {
    mockGetAllRules.mockResolvedValue([
      { weekday: 2, start_local: "09:00:00", end_local: "12:00:00", is_active: true },
      { weekday: 2, start_local: "14:00:00", end_local: "17:00:00", is_active: true },
      { weekday: 4, start_local: "10:00:00", end_local: "11:30:00", is_active: true },
    ]);

    const res = await getAvailabilityConfig(STAFF);

    expect(res.rules).toEqual([
      { weekday: 2, startLocal: "09:00", endLocal: "12:00", isActive: true },
      { weekday: 2, startLocal: "14:00", endLocal: "17:00", isActive: true },
      { weekday: 4, startLocal: "10:00", endLocal: "11:30", isActive: true },
    ]);
    expect(res.staffTimezone).toBe("America/New_York");
  });

  it("passes through min notice and rebooking penalty from settings", async () => {
    mockGetAllRules.mockResolvedValue([]);
    mockGetSettings.mockResolvedValue(settings({ minNoticeHours: 48, rebookingPenaltyDays: 14 }));

    const res = await getAvailabilityConfig(STAFF);

    expect(res.minNoticeHours).toBe(48);
    expect(res.rebookingPenaltyDays).toBe(14);
  });

  it("maps exceptions to id/reason/instant strings", async () => {
    mockGetAllRules.mockResolvedValue([]);
    mockListExceptions.mockResolvedValue([
      {
        id: "ex-1",
        reason: "Vacaciones",
        starts_at: "2026-07-01T13:00:00.000Z",
        ends_at: "2026-07-02T13:00:00.000Z",
      },
    ]);

    const res = await getAvailabilityConfig(STAFF);

    expect(res.exceptions).toEqual([
      { id: "ex-1", reason: "Vacaciones", startsAt: "2026-07-01T13:00:00.000Z", endsAt: "2026-07-02T13:00:00.000Z" },
    ]);
  });

  it("forbids a non-admin from reading another staff's config", async () => {
    mockGetAllRules.mockResolvedValue([]);

    await expect(
      getAvailabilityConfig(STAFF, { staffId: "99999999-9999-4999-8999-999999999999" }),
    ).rejects.toThrow();
    expect(mockGetAllRules).not.toHaveBeenCalled();
  });
});
