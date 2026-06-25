/**
 * TDD: getWeekAgenda — clientName resolution (API-SCH-12)
 *
 * Covers:
 *  - Case appointment → clientName resolved from client_profiles (preferred_name ?? first_name)
 *  - Lead appointment → clientName resolved from leads.full_name
 *  - No profile found → clientName null (never the raw UUID)
 *  - Empty week → returns empty list
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockServiceClient = vi.hoisted(() => vi.fn());
const mockCan           = vi.hoisted(() => vi.fn());

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  requireCaseAccess: vi.fn(),
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

// Scheduling repository stubs — only findOrgAppointmentsInRange is exercised here.
vi.mock("../repository.js", () => ({
  findOrgAppointmentsInRange: vi.fn(),
  getActiveRules: vi.fn().mockResolvedValue([]),
  findById: vi.fn().mockResolvedValue(null),
  findBookedForMaterialization: vi.fn().mockResolvedValue([]),
  getExceptionsInRange: vi.fn().mockResolvedValue([]),
  replaceRules: vi.fn().mockResolvedValue(undefined),
  upsertSettings: vi.fn().mockResolvedValue(undefined),
  upsertPhasePolicy: vi.fn().mockResolvedValue(undefined),
  setCaseOverride: vi.fn().mockResolvedValue(undefined),
  insertAppointment: vi.fn().mockResolvedValue({ id: "appt-new" }),
  updateAppointment: vi.fn().mockResolvedValue(undefined),
  findRules: vi.fn().mockResolvedValue([]),
  getSettings: vi.fn().mockResolvedValue(null),
  listExceptions: vi.fn().mockResolvedValue([]),
  listActivePhasePolices: vi.fn().mockResolvedValue([]),
  findCaseOverride: vi.fn().mockResolvedValue(null),
  findDueReminders: vi.fn().mockResolvedValue([]),
  markReminderSent: vi.fn().mockResolvedValue(false),
  getPhaseAppointmentsSummary: vi.fn().mockResolvedValue([]),
  insertException: vi.fn().mockResolvedValue(undefined),
  deleteException: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks
import { getWeekAgenda } from "../service";
import * as schedulingRepo from "../repository";
import type { Actor } from "@/backend/platform/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STAFF_ACTOR: Actor = {
  userId:      "11111111-1111-4111-8111-111111111001",
  orgId:       "22222222-2222-4222-8222-222222222001",
  role:        "sales",
  kind:        "staff",
  permissions: new Map([["calendar", { view: true, edit: true }]]),
};

const CLIENT_USER_ID = "33333333-3333-4333-8333-333333333001";
const LEAD_ID        = "44444444-4444-4444-8444-444444444001";
const CASE_ID        = "55555555-5555-4555-8555-555555555001";

function makeApptRow(overrides: Partial<{
  client_user_id: string | null;
  lead_id: string | null;
  case_id: string | null;
  client_note: string | null;
}> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    staff_id: STAFF_ACTOR.userId,
    org_id: STAFF_ACTOR.orgId,
    starts_at: "2026-06-08T15:00:00Z",
    ends_at:   "2026-06-08T15:30:00Z",
    kind: "video",
    status: "scheduled",
    sequence_number: 1,
    livekit_room_id: null,
    notes: null,
    client_note: null,
    reminder_sent_at: null,
    client_user_id: null,
    lead_id: null,
    case_id: null,
    ...overrides,
  };
}

/**
 * Builds a Supabase service-client mock that handles all three query paths:
 *
 *  1. from("users").select("timezone").eq("id", staffId).maybeSingle()
 *     → getUserTimezone() (returns staffTz)
 *
 *  2. from("client_profiles").select(...).in("user_id", ids)
 *     → enrichment batch (returns profileData)
 *
 *  3. from("leads").select(...).eq("org_id", orgId).in("id", ids)
 *     → enrichment batch (returns leadsData)
 *
 * Routing is by table name set in `from()`.
 */
function makeServiceClient(opts: {
  staffTz?: string;
  profileData?: unknown[];
  leadsData?: unknown[];
} = {}) {
  const staffTz    = opts.staffTz    ?? "America/New_York";
  const profileData = opts.profileData ?? [];
  const leadsData   = opts.leadsData   ?? [];

  let currentTable = "";

  // Thenable chain that resolves per-table in maybeSingle() or in()
  const chain: Record<string, unknown> = {
    from: vi.fn((t: string) => {
      currentTable = t;
      return chain;
    }),
    select: vi.fn(() => chain),
    eq:     vi.fn(() => chain),
    in:     vi.fn((_col: string, _vals: unknown[]) => {
      if (currentTable === "client_profiles") {
        return Promise.resolve({ data: profileData, error: null });
      }
      // leads
      return Promise.resolve({ data: leadsData, error: null });
    }),
    maybeSingle: vi.fn(() => {
      // Only called for users.timezone lookup
      return Promise.resolve({ data: { timezone: staffTz }, error: null });
    }),
  };

  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getWeekAgenda — clientName resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockImplementation(() => undefined);
  });

  it("case appointment → clientName from preferred_name when set", async () => {
    vi.mocked(schedulingRepo.findOrgAppointmentsInRange).mockResolvedValue([
      makeApptRow({ client_user_id: CLIENT_USER_ID, case_id: CASE_ID }) as never,
    ]);

    mockServiceClient.mockReturnValue(
      makeServiceClient({
        profileData: [{ user_id: CLIENT_USER_ID, first_name: "María", preferred_name: "Mari" }],
        leadsData: [],
      }),
    );

    const result = await getWeekAgenda(STAFF_ACTOR, { weekStartLocal: "2026-06-08" });

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0].clientName).toBe("Mari");
    // Must NOT expose the raw UUID
    expect(result.appointments[0].clientName).not.toBe(CLIENT_USER_ID);
  });

  it("case appointment → clientName falls back to first_name when preferred_name is null", async () => {
    vi.mocked(schedulingRepo.findOrgAppointmentsInRange).mockResolvedValue([
      makeApptRow({ client_user_id: CLIENT_USER_ID, case_id: CASE_ID }) as never,
    ]);

    mockServiceClient.mockReturnValue(
      makeServiceClient({
        profileData: [{ user_id: CLIENT_USER_ID, first_name: "María", preferred_name: null }],
        leadsData: [],
      }),
    );

    const result = await getWeekAgenda(STAFF_ACTOR, { weekStartLocal: "2026-06-08" });

    expect(result.appointments[0].clientName).toBe("María");
  });

  it("lead appointment → clientName from leads.full_name", async () => {
    vi.mocked(schedulingRepo.findOrgAppointmentsInRange).mockResolvedValue([
      makeApptRow({ lead_id: LEAD_ID, case_id: null, client_user_id: null }) as never,
    ]);

    mockServiceClient.mockReturnValue(
      makeServiceClient({
        profileData: [],
        leadsData: [{ id: LEAD_ID, full_name: "Juan Pérez" }],
      }),
    );

    const result = await getWeekAgenda(STAFF_ACTOR, { weekStartLocal: "2026-06-08" });

    expect(result.appointments[0].clientName).toBe("Juan Pérez");
    // Must NOT expose the raw UUID
    expect(result.appointments[0].clientName).not.toBe(LEAD_ID);
  });

  it("no profile found → clientName is null, not the UUID", async () => {
    vi.mocked(schedulingRepo.findOrgAppointmentsInRange).mockResolvedValue([
      makeApptRow({ client_user_id: CLIENT_USER_ID, case_id: CASE_ID }) as never,
    ]);

    // Enrichment returns empty — client not yet provisioned
    mockServiceClient.mockReturnValue(makeServiceClient({ profileData: [], leadsData: [] }));

    const result = await getWeekAgenda(STAFF_ACTOR, { weekStartLocal: "2026-06-08" });

    expect(result.appointments[0].clientName).toBeNull();
    expect(result.appointments[0].clientName).not.toBe(CLIENT_USER_ID);
  });

  it("maps client_note → clientNote (read-only client note, distinct from notes)", async () => {
    vi.mocked(schedulingRepo.findOrgAppointmentsInRange).mockResolvedValue([
      makeApptRow({
        client_user_id: CLIENT_USER_ID,
        case_id: CASE_ID,
        client_note: "Tengo dudas sobre mi I-765",
      }) as never,
    ]);

    mockServiceClient.mockReturnValue(
      makeServiceClient({
        profileData: [{ user_id: CLIENT_USER_ID, first_name: "María", preferred_name: null }],
      }),
    );

    const result = await getWeekAgenda(STAFF_ACTOR, { weekStartLocal: "2026-06-08" });

    expect(result.appointments[0].clientNote).toBe("Tengo dudas sobre mi I-765");
    // Staff log stays separate (null here).
    expect(result.appointments[0].notes).toBeNull();
  });

  it("empty week → appointments is empty, no enrichment .in() calls made", async () => {
    vi.mocked(schedulingRepo.findOrgAppointmentsInRange).mockResolvedValue([]);

    const client = makeServiceClient();
    mockServiceClient.mockReturnValue(client);

    const result = await getWeekAgenda(STAFF_ACTOR, { weekStartLocal: "2026-06-08" });

    expect(result.appointments).toHaveLength(0);
    // Enrichment queries use .in() — it must not have been called when there are no appointments.
    expect(vi.mocked(client.in as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
