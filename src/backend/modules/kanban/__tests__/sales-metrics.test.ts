/**
 * TDD: getSalesMetrics (API-MET-01, DOC-52 §6.2)
 *
 * Covers:
 *  - Funnel stage counts from leads + appointments + contracts
 *  - Source aggregation with conversion rate
 *  - AuthzError propagates when actor lacks metrics permission
 *  - Empty data → zero funnel, empty sources, null conversionPct
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockServiceClient = vi.hoisted(() => vi.fn());
const mockCan           = vi.hoisted(() => vi.fn());

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
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

// Kanban repository — stub all fns
vi.mock("../repository.js", () => ({
  findBoard: vi.fn().mockResolvedValue(null),
  createBoardWithSeed: vi.fn().mockResolvedValue({ id: "board-1" }),
  listColumns: vi.fn().mockResolvedValue([]),
  listCards: vi.fn().mockResolvedValue([]),
  findColumn: vi.fn().mockResolvedValue(null),
  insertColumn: vi.fn().mockResolvedValue({}),
  updateColumn: vi.fn().mockResolvedValue({}),
  deleteColumn: vi.fn().mockResolvedValue(undefined),
  findCard: vi.fn().mockResolvedValue(null),
  findCardByRef: vi.fn().mockResolvedValue(null),
  insertCard: vi.fn().mockResolvedValue({}),
  updateCard: vi.fn().mockResolvedValue({}),
  deleteCard: vi.fn().mockResolvedValue(undefined),
  maxCardPosition: vi.fn().mockResolvedValue(0),
  findLead: vi.fn().mockResolvedValue(null),
  listLeads: vi.fn().mockResolvedValue([]),
  insertLead: vi.fn().mockResolvedValue({}),
  updateLead: vi.fn().mockResolvedValue({}),
  findCategory: vi.fn().mockResolvedValue(null),
  insertCategory: vi.fn().mockResolvedValue({}),
  findTask: vi.fn().mockResolvedValue(null),
  insertTask: vi.fn().mockResolvedValue({}),
  updateTask: vi.fn().mockResolvedValue({}),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  maxTaskPosition: vi.fn().mockResolvedValue(0),
  findFinanceStaff: vi.fn().mockResolvedValue([]),
  listTasks: vi.fn().mockResolvedValue([]),
}));

// Import after mocks
import { getSalesMetrics } from "../service";
import type { Actor } from "@/backend/platform/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STAFF_ACTOR: Actor = {
  userId:      "11111111-1111-4111-8111-111111111001",
  orgId:       "22222222-2222-4222-8222-222222222001",
  role:        "sales",
  kind:        "staff",
  permissions: new Map([["metrics", { view: true, edit: false }]]),
};

const CASE_ID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASE_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Build a Supabase service-client mock where each call to `.lt()` (the
 * terminal filter in getSalesMetrics) or `.not()` (for cases/appointments
 * without date ranges) resolves with the next item from `callQueue`.
 *
 * The `.in()` method is intercepted separately and resolves with `inData`.
 */
function makeChainMock(callQueue: unknown[][], inData: unknown[] = []) {
  let callIdx = 0;

  // Each call in the service builds a chain: from().select().eq()…lt()
  // We make the chain object itself act as a thenable when the service
  // awaits it. The "resolve" call is triggered by the last filter method.
  // Strategy: `lt` and the first `not` (on appointments) are the final
  // builder calls before Promise.all awaits the chain.

  function makeCall(data: unknown[]) {
    // Return a thenable that also has all builder methods
    const p = Promise.resolve({ data, error: null });
    return Object.assign(p, {
      eq:     () => makeCall(data),
      gte:    () => makeCall(data),
      lt:     () => makeCall(data),
      not:    () => makeCall(data),
      select: () => makeCall(data),
      in:     (_col: string, _vals: unknown[]) => Promise.resolve({ data: inData, error: null }),
    });
  }

  const root = {
    from: () => {
      const data = callQueue[callIdx++] ?? [];
      return {
        select: () => makeCall(data),
      };
    },
  };

  return root;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getSalesMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockImplementation(() => undefined);
  });

  it("funnel counts match leads + appointments + contracts", async () => {
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const leads = [
      // stage0: 3; stage1: 2 contacted; stage2: 1 won
      { id: "l1", contacted_at: from, won_case_id: CASE_ID_1, status: "won",    source: "web",    created_at: from },
      { id: "l2", contacted_at: from, won_case_id: null,      status: "active", source: "web",    created_at: from },
      { id: "l3", contacted_at: null, won_case_id: null,      status: "active", source: "tiktok", created_at: from },
    ];

    const appts = [
      // stage3: 1 completed
      { id: "a1", status: "completed", starts_at: from, case_id: CASE_ID_1, lead_id: null },
      { id: "a2", status: "scheduled", starts_at: from, case_id: CASE_ID_2, lead_id: null },
    ];

    const contracts = [{ id: "c1", signed_at: from, case_id: CASE_ID_1 }];

    // callQueue order mirrors Promise.all in getSalesMetrics:
    // 0: current leads, 1: prev leads, 2: current contracts, 3: prev contracts,
    // 4: ready cases, 5: current appointments
    const callQueue = [leads, [], contracts, [], [], appts];
    // inData for the follow-up cases ownership check
    const actorCases = [{ id: CASE_ID_1 }];

    mockServiceClient.mockReturnValue(makeChainMock(callQueue, actorCases));

    const result = await getSalesMetrics(STAFF_ACTOR, { period: "week" });

    expect(result.funnel.stage0).toBe(3);
    expect(result.funnel.stage1).toBe(2);
    expect(result.funnel.stage2).toBe(1);
    expect(result.funnel.stage3).toBe(1); // 1 completed appointment
    expect(result.funnel.stage4).toBe(1); // 1 contract attributed to actor
    expect(result.newLeadsCount).toBe(3);
    expect(result.closuresCount).toBe(1);
  });

  it("source aggregation groups leads by source with conversion", async () => {
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const leads = [
      { id: "l1", source: "web",    status: "won",    won_case_id: "c1", contacted_at: from, created_at: from },
      { id: "l2", source: "web",    status: "active", won_case_id: null, contacted_at: from, created_at: from },
      { id: "l3", source: "tiktok", status: "won",    won_case_id: "c2", contacted_at: null, created_at: from },
    ];

    // queue: leads, prevLeads=[], contracts=[], prevContracts=[], readyCases=[], appts=[]
    const callQueue = [leads, [], [], [], [], []];
    mockServiceClient.mockReturnValue(makeChainMock(callQueue));

    const result = await getSalesMetrics(STAFF_ACTOR, { period: "week" });

    const webSource    = result.sources.find((s) => s.source === "web");
    const tiktokSource = result.sources.find((s) => s.source === "tiktok");

    expect(webSource).toBeDefined();
    expect(webSource!.total).toBe(2);
    expect(webSource!.won).toBe(1);

    expect(tiktokSource).toBeDefined();
    expect(tiktokSource!.total).toBe(1);
    expect(tiktokSource!.won).toBe(1);
  });

  it("empty data → zero funnel, null conversionPct", async () => {
    mockServiceClient.mockReturnValue(makeChainMock([[], [], [], [], [], []]));

    const result = await getSalesMetrics(STAFF_ACTOR, { period: "week" });

    expect(result.funnel.stage0).toBe(0);
    expect(result.conversionPct).toBeNull(); // DOC-50 §5: no leads → "—", never false 0%
    expect(result.sources).toHaveLength(0);
    expect(result.newLeadsCount).toBe(0);
    expect(result.closuresCount).toBe(0);
  });

  it("actor without metrics permission → can() throws → error propagates", async () => {
    mockCan.mockImplementation(() => {
      throw new Error("forbidden_module");
    });
    // Client should never be called — but provide a stub in case
    mockServiceClient.mockReturnValue(makeChainMock([]));

    await expect(
      getSalesMetrics(STAFF_ACTOR, { period: "week" }),
    ).rejects.toThrow("forbidden_module");
  });
});
