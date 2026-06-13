/**
 * C-2: expressServiceInterest — org validation + no_phone guard (TDD).
 * H-6: LEAD_NOT_FOUND code used for lead-by-id 404s (not LEAD_PHONE_INVALID).
 *
 * Tests the F3 code-review fixes:
 *   C-2(a): clientUserId must belong to clientOrgId — rejected with org_mismatch
 *   C-2(c): no phone_e164 on user → returns { created: false, reason: 'no_phone' }
 *           instead of inserting a fake placeholder phone
 *   H-6:    markLeadWon / markLeadLost / updateLead / createCaseFromLead throw
 *           LEAD_NOT_FOUND (not LEAD_PHONE_INVALID) when the lead row is absent
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

// We'll build a chainable Supabase client stub that returns different data
// per .from() call.
const mockFrom = vi.hoisted(() => vi.fn());
const mockFindLead = vi.hoisted(() => vi.fn());
const mockInsertLead = vi.hoisted(() => vi.fn());
const mockFindBoard = vi.hoisted(() => vi.fn());
const mockCreateBoardWithSeed = vi.hoisted(() => vi.fn());
const mockListColumns = vi.hoisted(() => vi.fn());
const mockMaxCardPosition = vi.hoisted(() => vi.fn());
const mockInsertCard = vi.hoisted(() => vi.fn());
const mockUpdateLead = vi.hoisted(() => vi.fn());

vi.mock("@/backend/platform/supabase", () => {
  // Chainable builder that always resolves to { data: null, error: null }
  // unless overridden per call via mockFrom
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return {
    createServiceClient: () => ({ from: mockFrom }),
    createServerClient: () => ({}),
  };
});

vi.mock("../repository.js", () => ({
  findLead: mockFindLead,
  insertLead: mockInsertLead,
  findBoard: mockFindBoard,
  createBoardWithSeed: mockCreateBoardWithSeed,
  listColumns: mockListColumns,
  maxCardPosition: mockMaxCardPosition,
  insertCard: mockInsertCard,
  updateLead: mockUpdateLead,
  findCard: vi.fn().mockResolvedValue(null),
  findColumn: vi.fn().mockResolvedValue(null),
  listLeads: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  findLeadsByLast4: vi.fn().mockResolvedValue([]),
  getBoard: vi.fn().mockResolvedValue(null),
  updateCard: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  systemActor: { userId: "system", orgId: "org-system", role: "admin", kind: "staff" },
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn() },
}));

// normalizePhoneE164 is dynamically imported inside updateLead and expressServiceInterest
// via `await import("@/backend/modules/identity" as string)`. Vitest resolves
// dynamic string-casted imports, so we need to mock the real path.
vi.mock("@/backend/modules/identity", () => ({
  normalizePhoneE164: (phone: string) => {
    // Minimal: return null for clearly invalid, passthrough for E.164-like
    if (/^\+\d{7,15}$/.test(phone)) return phone;
    return null;
  },
  isValidEmail: (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks
import { expressServiceInterest, markLeadWon, markLeadLost, updateLead } from "../service";
import { KanbanError } from "../service";
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

const CLIENT_USER_ID   = "33333333-3333-4333-8333-333333333003";
const CLIENT_ORG_ID    = "44444444-4444-4444-8444-444444444004";
const SERVICE_UUID     = "55555555-5555-4555-8555-555555555005";
const LEAD_ID          = "66666666-6666-4666-8666-666666666006";

// Helper: creates a chainable Supabase query builder that resolves to { data, error }
function makeChain(resolvedData: unknown) {
  const chain: Record<string, unknown> = {};
  const resolve = () => Promise.resolve({ data: resolvedData, error: null });
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.gte = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = resolve;
  chain.single = resolve;
  return chain;
}

// ---------------------------------------------------------------------------
// C-2(a): org mismatch
// ---------------------------------------------------------------------------

describe("C-2(a): expressServiceInterest — org mismatch rejected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { created: false, reason: 'org_mismatch' } when user belongs to a different org", async () => {
    // User found but org_id doesn't match
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return makeChain({ org_id: "different-org-id", phone_e164: "+15551234567" });
      }
      return makeChain(null);
    });

    const result = await expressServiceInterest({
      interestedServiceId: SERVICE_UUID,
      clientUserId: CLIENT_USER_ID,
      clientOrgId: CLIENT_ORG_ID,
    });

    expect(result).toEqual({ created: false, reason: "org_mismatch" });
    // Should NOT have inserted a lead
    expect(mockInsertLead).not.toHaveBeenCalled();
  });

  it("returns { created: false, reason: 'org_mismatch' } when user not found at all", async () => {
    mockFrom.mockImplementation((_table: string) => makeChain(null));

    const result = await expressServiceInterest({
      interestedServiceId: SERVICE_UUID,
      clientUserId: CLIENT_USER_ID,
      clientOrgId: CLIENT_ORG_ID,
    });

    expect(result).toEqual({ created: false, reason: "org_mismatch" });
    expect(mockInsertLead).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C-2(c): no phone
// ---------------------------------------------------------------------------

describe("C-2(c): expressServiceInterest — no_phone guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { created: false, reason: 'no_phone' } when user has no phone_e164", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        // User is in the correct org but has no phone
        return makeChain({ org_id: CLIENT_ORG_ID, phone_e164: null });
      }
      return makeChain(null);
    });

    const result = await expressServiceInterest({
      interestedServiceId: SERVICE_UUID,
      clientUserId: CLIENT_USER_ID,
      clientOrgId: CLIENT_ORG_ID,
    });

    expect(result).toEqual({ created: false, reason: "no_phone" });
    // CRITICAL: must not have inserted a fake phone placeholder
    expect(mockInsertLead).not.toHaveBeenCalled();
  });

  it("does NOT invent +10000000000 or any placeholder phone", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return makeChain({ org_id: CLIENT_ORG_ID, phone_e164: null });
      }
      return makeChain(null);
    });

    await expressServiceInterest({
      interestedServiceId: SERVICE_UUID,
      clientUserId: CLIENT_USER_ID,
      clientOrgId: CLIENT_ORG_ID,
    });

    // Ensure insertLead was never called with any placeholder
    expect(mockInsertLead).not.toHaveBeenCalled();
  });

  it("proceeds normally when user has a valid phone (happy path)", async () => {
    // Setup: user in correct org with valid phone; no duplicate; has assigned sales staff.
    // The users table is hit twice:
    //   1. For org+phone check (.select("org_id, phone_e164").eq("id",...).maybeSingle())
    //   2. For staff lookup (.select("id").eq("org_id",...).eq("kind","staff").eq("is_active",true))
    // Differentiate by tracking calls
    let userCallIdx = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        userCallIdx++;
        if (userCallIdx === 1) {
          // First: org + phone check — returns single row via .maybeSingle()
          return makeChain({ org_id: CLIENT_ORG_ID, phone_e164: "+15551234567" });
        }
        // Second: staff list — the code does .select("id")...then accesses .data
        // The chain needs to return { data: [{id: ...}] } via whatever path the code takes.
        // expressServiceInterest uses: const { data: orgUsers } = await client.from("users")...
        // That's NOT .maybeSingle() — it's a plain query that returns { data: [] }
        const staffChain: Record<string, unknown> = {
          select: () => staffChain,
          eq: () => staffChain,
          then: (resolve: (v: { data: {id: string}[] }) => unknown) =>
            Promise.resolve({ data: [{ id: STAFF_ACTOR.userId }] }).then(resolve),
        };
        return staffChain;
      }
      if (table === "leads") return makeChain(null); // no recent duplicate
      if (table === "staff_profiles") {
        // Sales staff lookup via .maybeSingle()
        return makeChain({ user_id: STAFF_ACTOR.userId });
      }
      return makeChain(null);
    });

    const leadRow = { id: LEAD_ID, org_id: CLIENT_ORG_ID, phone_e164: "+15551234567", status: "open" };
    mockInsertLead.mockResolvedValue(leadRow);
    mockFindBoard.mockResolvedValue({ id: "board-id-001" });
    mockListColumns.mockResolvedValue([{ id: "col-1", position: 0 }]);
    mockMaxCardPosition.mockResolvedValue(0);
    mockInsertCard.mockResolvedValue({});

    // Override the assignedSalesStaffId to skip the staff-lookup entirely
    const result = await expressServiceInterest({
      interestedServiceId: SERVICE_UUID,
      clientUserId: CLIENT_USER_ID,
      clientOrgId: CLIENT_ORG_ID,
      assignedSalesStaffId: STAFF_ACTOR.userId, // bypass auto-lookup
    });

    expect(result.created).toBe(true);
    expect(mockInsertLead).toHaveBeenCalledWith(
      expect.objectContaining({ phone_e164: "+15551234567" }),
    );
  });
});

// ---------------------------------------------------------------------------
// H-6: LEAD_NOT_FOUND — lead-by-id 404s use correct code
// ---------------------------------------------------------------------------

describe("H-6: LEAD_NOT_FOUND thrown for lead-by-id 404 (not LEAD_PHONE_INVALID)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindLead.mockResolvedValue(null);
  });

  it("markLeadWon throws LEAD_NOT_FOUND when lead is null", async () => {
    await expect(
      markLeadWon(STAFF_ACTOR, LEAD_ID),
    ).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
  });

  it("markLeadWon does NOT throw LEAD_PHONE_INVALID for null lead", async () => {
    const err = await markLeadWon(STAFF_ACTOR, LEAD_ID).catch((e) => e);
    expect(err).toBeInstanceOf(KanbanError);
    expect(err.code).not.toBe("LEAD_PHONE_INVALID");
  });

  it("markLeadLost throws LEAD_NOT_FOUND when lead is null", async () => {
    await expect(
      markLeadLost(STAFF_ACTOR, LEAD_ID, "budget"),
    ).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
  });

  it("updateLead throws LEAD_NOT_FOUND when lead is null", async () => {
    await expect(
      updateLead(STAFF_ACTOR, { leadId: LEAD_ID }),
    ).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
  });

  it("LEAD_PHONE_INVALID is still thrown for actual invalid phone format", async () => {
    // updateLead with a new invalid phone — lead exists but phone is invalid
    const existingLead = {
      id: LEAD_ID,
      org_id: STAFF_ACTOR.orgId,
      phone_e164: "+15551234567",
      contacted_at: null,
      full_name: null,
      source: "inbound",
      status: "open",
      assigned_to: null,
      interested_service_id: null,
      category_id: null,
      note: null,
      won_case_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockFindLead.mockResolvedValue(existingLead);

    await expect(
      updateLead(STAFF_ACTOR, { leadId: LEAD_ID, phone: "not-a-phone" }),
    ).rejects.toMatchObject({ code: "LEAD_PHONE_INVALID" });
  });
});
