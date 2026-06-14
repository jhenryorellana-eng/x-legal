/**
 * TDD: getAppointmentAdvisor (API-SCH-17)
 *
 * Covers:
 *  - client member of case → receives {displayName, avatarUrl}
 *  - client non-member (requireCaseAccess throws AuthzError) → error propagates
 *  - appointment not found → null
 *  - staff profile not found → null
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockFindById      = vi.hoisted(() => vi.fn());
const mockRequireCaseAccess = vi.hoisted(() => vi.fn());
const mockServiceClient = vi.hoisted(() => vi.fn());

vi.mock("../repository.js", () => ({
  findById: mockFindById,
  // All other repo fns used in scheduling/service.ts — stub as no-ops so the
  // module loads cleanly without touching the DB.
  getSettings: vi.fn().mockResolvedValue({
    min_notice_hours: 24,
    max_advance_days: 30,
    buffer_minutes: 0,
    cancellation_window_hours: 24,
    rebooking_penalty_days: 7,
  }),
  getActiveRules: vi.fn().mockResolvedValue([]),
  getExceptionsInRange: vi.fn().mockResolvedValue([]),
  findBookedForMaterialization: vi.fn().mockResolvedValue([]),
  findStaffAppointmentsInRange: vi.fn().mockResolvedValue([]),
  insertAppointment: vi.fn(),
  updateAppointment: vi.fn(),
  countPhaseAppointments: vi.fn().mockResolvedValue(0),
  getPhasePolicy: vi.fn().mockResolvedValue(null),
  getCaseOverride: vi.fn().mockResolvedValue(null),
  getPhaseSequenceNumbers: vi.fn().mockResolvedValue([]),
  findScheduledInRange: vi.fn().mockResolvedValue([]),
  findScheduledOutsideRules: vi.fn().mockResolvedValue([]),
  insertException: vi.fn().mockResolvedValue({}),
  deleteException: vi.fn().mockResolvedValue(undefined),
  replaceRules: vi.fn().mockResolvedValue([]),
  upsertSettings: vi.fn().mockResolvedValue({}),
  upsertPhasePolicy: vi.fn().mockResolvedValue({}),
  upsertCaseOverride: vi.fn().mockResolvedValue({}),
  deleteCaseOverride: vi.fn().mockResolvedValue(undefined),
  rewriteRulesTimezone: vi.fn().mockResolvedValue(undefined),
  findDueReminders: vi.fn().mockResolvedValue([]),
  markReminderSent: vi.fn().mockResolvedValue(true),
  getPhaseAppointmentsSummary: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: mockRequireCaseAccess,
  systemActor: { userId: "system", orgId: "org-system", role: "admin", kind: "staff" },
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
      this.name = "AuthzError";
    }
  },
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: mockServiceClient,
  createServerClient: vi.fn(() => ({})),
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn() },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { getAppointmentAdvisor } from "../service";
import type { Actor } from "@/backend/platform/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ACTOR: Actor = {
  userId:      "11111111-1111-4111-8111-111111111001",
  orgId:       "22222222-2222-4222-8222-222222222001",
  role:        null,
  kind:        "client",
  permissions: new Map(),
};

const APPT_ID   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASE_ID   = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STAFF_ID  = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeAppt() {
  return {
    id: APPT_ID,
    case_id: CASE_ID,
    lead_id: null,
    staff_id: STAFF_ID,
    client_user_id: CLIENT_ACTOR.userId,
    starts_at: "2026-06-20T14:00:00Z",
    ends_at:   "2026-06-20T14:30:00Z",
    kind: "video",
    status: "scheduled",
    sequence_number: 1,
    notes: null,
    reminder_1d: true,
    reminder_1h: false,
    livekit_room_id: null,
    reminder_1d_sent_at: null,
    reminder_1h_sent_at: null,
    service_phase_id: null,
    cancelled_at: null,
    cancel_reason: null,
    org_id: CLIENT_ACTOR.orgId,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Chainable Supabase stub helper
// ---------------------------------------------------------------------------

function makeDbChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: resolvedValue, error: null });
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getAppointmentAdvisor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: access allowed (requireCaseAccess resolves without throwing)
    mockRequireCaseAccess.mockResolvedValue(undefined);
  });

  it("client member of case → returns displayName and avatarUrl", async () => {
    mockFindById.mockResolvedValue(makeAppt());
    const profileData = { display_name: "Diana Restrepo", avatar_url: null };
    const chain = makeDbChain(profileData);
    mockServiceClient.mockReturnValue(chain);

    const result = await getAppointmentAdvisor(CLIENT_ACTOR, APPT_ID);

    expect(result).toEqual({ displayName: "Diana Restrepo", avatarUrl: null });
    expect(mockRequireCaseAccess).toHaveBeenCalledWith(CLIENT_ACTOR, CASE_ID);
    // Verify we only requested the minimal fields
    expect(chain.select).toHaveBeenCalledWith("display_name, avatar_url");
    expect(chain.eq).toHaveBeenCalledWith("user_id", STAFF_ID);
  });

  it("client member, avatarUrl present → returned in result", async () => {
    mockFindById.mockResolvedValue(makeAppt());
    const profileData = { display_name: "Vanessa Rios", avatar_url: "https://cdn.example.com/v.jpg" };
    const chain = makeDbChain(profileData);
    mockServiceClient.mockReturnValue(chain);

    const result = await getAppointmentAdvisor(CLIENT_ACTOR, APPT_ID);

    expect(result).toEqual({ displayName: "Vanessa Rios", avatarUrl: "https://cdn.example.com/v.jpg" });
  });

  it("appointment not found → returns null without calling requireCaseAccess", async () => {
    mockFindById.mockResolvedValue(null);

    const result = await getAppointmentAdvisor(CLIENT_ACTOR, APPT_ID);

    expect(result).toBeNull();
    expect(mockRequireCaseAccess).not.toHaveBeenCalled();
  });

  it("client non-member (requireCaseAccess throws) → error propagates (forbidden_case)", async () => {
    mockFindById.mockResolvedValue(makeAppt());
    mockRequireCaseAccess.mockRejectedValue(new Error("forbidden_case"));

    await expect(getAppointmentAdvisor(CLIENT_ACTOR, APPT_ID)).rejects.toThrow("forbidden_case");
  });

  it("staff_profile row missing → returns null", async () => {
    mockFindById.mockResolvedValue(makeAppt());
    const chain = makeDbChain(null); // profile not found
    mockServiceClient.mockReturnValue(chain);

    const result = await getAppointmentAdvisor(CLIENT_ACTOR, APPT_ID);

    expect(result).toBeNull();
  });

  it("prospect appointment (no case_id) + non-staff actor → returns null", async () => {
    const prospectAppt = { ...makeAppt(), case_id: null };
    mockFindById.mockResolvedValue(prospectAppt);

    const result = await getAppointmentAdvisor(CLIENT_ACTOR, APPT_ID);

    expect(result).toBeNull();
    expect(mockRequireCaseAccess).not.toHaveBeenCalled();
  });
});
