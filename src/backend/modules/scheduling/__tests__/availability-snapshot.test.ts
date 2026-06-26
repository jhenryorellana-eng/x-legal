/**
 * Snapshot availability model (DOC-23 §6.4).
 *
 * `saveAvailabilityRules` persists each rule with the EDITOR's own profile
 * timezone verbatim — NO collapse to a single office TZ — and
 * `getAvailabilityConfig` translates each rule from its snapshot zone to the
 * viewer. Together they guarantee "saved exactly as I see it in my zone" with
 * zero DST drift for zones without DST (America/Lima, America/Bogota): the bug
 * where a slot picker disagreed with the displayed schedule cannot recur,
 * because storage and display each have a single, well-defined zone.
 *
 * The viewer/editor profile here lives in America/Bogota.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReplaceRules = vi.hoisted(() => vi.fn());
const mockFindOutside = vi.hoisted(() => vi.fn());
const mockGetAllRules = vi.hoisted(() => vi.fn());
const mockGetSettings = vi.hoisted(() => vi.fn());
const mockListExceptions = vi.hoisted(() => vi.fn());

vi.mock("../repository.js", () => ({
  replaceRules: mockReplaceRules,
  findScheduledOutsideRules: mockFindOutside,
  getAllRules: mockGetAllRules,
  getSettings: mockGetSettings,
  listExceptions: mockListExceptions,
  // Office/global reference TZ (the "Utah" chip + fallback for snapshot-less rules).
  getOfficeTimezone: vi.fn().mockResolvedValue("America/Denver"),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn(),
  AuthzError: class AuthzError extends Error {},
  systemActor: { userId: "system", orgId: "org-system", role: "admin", kind: "staff" },
}));

// getUserTimezone reads users.timezone via a chained query; the editor/viewer
// profile lives in America/Bogota.
vi.mock("@/backend/platform/supabase", () => {
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: { timezone: "America/Bogota" } })),
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

import { saveAvailabilityRules, getAvailabilityConfig } from "../service";
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
  mockReplaceRules.mockResolvedValue(undefined);
  mockFindOutside.mockResolvedValue([]);
  mockGetSettings.mockResolvedValue({
    minNoticeHours: 24,
    maxAdvanceDays: 30,
    bufferMinutes: 0,
    cancellationWindowHours: 24,
    rebookingPenaltyDays: 7,
    prospectDurationMinutes: 60,
  });
  mockListExceptions.mockResolvedValue([]);
});

describe("saveAvailabilityRules (snapshot model)", () => {
  it("persists each rule verbatim, stamped with the editor's own profile TZ", async () => {
    await saveAvailabilityRules(STAFF, {
      rules: [{ weekday: 6, startLocal: "09:00", endLocal: "12:00" }],
    });

    // Stored exactly as the editor typed it ("as I see it in my zone"), with the
    // editor's zone as the rule snapshot — no conversion to a single office TZ.
    expect(mockReplaceRules).toHaveBeenCalledWith(STAFF.orgId, [
      { weekday: 6, startLocal: "09:00", endLocal: "12:00", timezone: "America/Bogota", isActive: true },
    ]);
  });
});

describe("getAvailabilityConfig (per-rule snapshot translation)", () => {
  it("shows a Lima-stored rule unchanged to a Bogota viewer (same offset, no DST)", async () => {
    mockGetAllRules.mockResolvedValue([
      {
        weekday: 6,
        start_local: "09:00:00",
        end_local: "12:00:00",
        is_active: true,
        timezone: "America/Lima",
      },
    ]);

    const res = await getAvailabilityConfig(STAFF); // viewer = America/Bogota

    // Lima and Bogota are both UTC-5 year-round → identical wall time, no drift.
    expect(res.rules).toEqual([
      { weekday: 6, startLocal: "09:00", endLocal: "12:00", isActive: true },
    ]);
    expect(res.staffTimezone).toBe("America/Bogota");
  });
});
