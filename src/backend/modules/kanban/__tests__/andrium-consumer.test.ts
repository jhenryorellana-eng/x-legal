/**
 * Kanban consumer — onExpedienteSentToFinance (F5-Ola3)
 *
 * Covers:
 *  - Creates card on "Por imprimir" column of Andrium's collections board
 *  - Lazy-creates the board if not found
 *  - Idempotent: skips if card already exists on board
 *  - Skips if no finance staff found
 *  - Creates cards for EACH finance staff member
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockFindFinanceStaff,
  mockFindBoard,
  mockCreateBoardWithSeed,
  mockFindCardByRef,
  mockListColumns,
  mockMaxCardPosition,
  mockInsertCard,
} = vi.hoisted(() => ({
  mockFindFinanceStaff: vi.fn(),
  mockFindBoard: vi.fn(),
  mockCreateBoardWithSeed: vi.fn(),
  mockFindCardByRef: vi.fn(),
  mockListColumns: vi.fn(),
  mockMaxCardPosition: vi.fn().mockResolvedValue(0),
  mockInsertCard: vi.fn().mockResolvedValue({ id: "card-1" }),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  systemActor: () => ({ userId: "00000000-0000-0000-0000-000000000000", orgId: "sys", role: "admin", kind: "staff" }),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
      this.name = "AuthzError";
    }
  },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(() => ({ channel: vi.fn(() => ({ send: vi.fn().mockResolvedValue(undefined) })) })),
  createServerClient: vi.fn(),
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), on: vi.fn() },
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository.js", () => ({
  findBoard: mockFindBoard,
  createBoardWithSeed: mockCreateBoardWithSeed,
  listColumns: mockListColumns,
  listCards: vi.fn().mockResolvedValue([]),
  findColumn: vi.fn().mockResolvedValue(null),
  insertColumn: vi.fn().mockResolvedValue({}),
  updateColumn: vi.fn().mockResolvedValue({}),
  deleteColumn: vi.fn().mockResolvedValue(undefined),
  reorderColumns: vi.fn().mockResolvedValue(undefined),
  findCard: vi.fn().mockResolvedValue(null),
  findCardByRef: mockFindCardByRef,
  insertCard: mockInsertCard,
  updateCard: vi.fn().mockResolvedValue({}),
  deleteCard: vi.fn().mockResolvedValue(undefined),
  moveCard: vi.fn().mockResolvedValue(undefined),
  maxCardPosition: mockMaxCardPosition,
  updateCardNote: vi.fn().mockResolvedValue(undefined),
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
  findFinanceStaff: mockFindFinanceStaff,
  listTasks: vi.fn().mockResolvedValue([]),
  listLeadsByCategory: vi.fn().mockResolvedValue([]),
  countLeadsByMonth: vi.fn().mockResolvedValue([]),
  countLeadsBySource: vi.fn().mockResolvedValue([]),
  countWonCasesByMonth: vi.fn().mockResolvedValue([]),
  countAppointmentsByMonth: vi.fn().mockResolvedValue([]),
  avgContactTime: vi.fn().mockResolvedValue(null),
  countRescheduledByMonth: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/backend/modules/cases", () => ({
  getCaseSummary: vi.fn(),
  changeCaseStatus: vi.fn(),
  canTransitionCase: vi.fn().mockReturnValue(null),
}));

vi.mock("@/backend/modules/identity", () => ({
  normalizePhoneE164: (p: string) => (/^\+\d{7,15}$/.test(p) ? p : null),
}));

// Import after mocks
import { onExpedienteSentToFinance } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID  = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOARD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const financeStaff = [
  { userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", role: "finance" },
];

const seedBoard = { id: BOARD_ID, owner_staff_id: financeStaff[0].userId, board_kind: "collections" };

const collectionsColumns = [
  { id: "col-1", board_id: BOARD_ID, label: "Por cobrar inicial", position: 1, color: "accent", is_terminal_won: false, is_terminal_lost: false },
  { id: "col-2", board_id: BOARD_ID, label: "Cuotas por vencer",  position: 2, color: "gold",   is_terminal_won: false, is_terminal_lost: false },
  { id: "col-3", board_id: BOARD_ID, label: "Vencidas",           position: 3, color: "red",    is_terminal_won: false, is_terminal_lost: false },
  { id: "col-4", board_id: BOARD_ID, label: "Por imprimir",       position: 4, color: "navy",   is_terminal_won: false, is_terminal_lost: false },
  { id: "col-5", board_id: BOARD_ID, label: "Hecho",              position: 5, color: "green",  is_terminal_won: true,  is_terminal_lost: false },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("kanban: onExpedienteSentToFinance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFinanceStaff.mockResolvedValue(financeStaff);
    mockFindBoard.mockResolvedValue(seedBoard);
    mockFindCardByRef.mockResolvedValue(null); // no existing card
    mockListColumns.mockResolvedValue(collectionsColumns);
    mockMaxCardPosition.mockResolvedValue(0);
    mockInsertCard.mockResolvedValue({ id: "card-new" });
    mockCreateBoardWithSeed.mockResolvedValue(seedBoard);
  });

  it("creates a card on the 'Por imprimir' column", async () => {
    await onExpedienteSentToFinance({ caseId: CASE_ID, orgId: ORG_ID });
    expect(mockInsertCard).toHaveBeenCalledWith(
      expect.objectContaining({
        column_id: "col-4",
        ref_type: "case",
        ref_id: CASE_ID,
      }),
    );
  });

  it("does NOT create card if one already exists on board (idempotency)", async () => {
    mockFindCardByRef.mockResolvedValue({ id: "existing-card", column_id: "col-4" });
    await onExpedienteSentToFinance({ caseId: CASE_ID, orgId: ORG_ID });
    expect(mockInsertCard).not.toHaveBeenCalled();
  });

  it("lazy-creates the board when not found", async () => {
    mockFindBoard.mockResolvedValue(null);
    mockCreateBoardWithSeed.mockResolvedValue(seedBoard);
    await onExpedienteSentToFinance({ caseId: CASE_ID, orgId: ORG_ID });
    expect(mockCreateBoardWithSeed).toHaveBeenCalledWith(
      financeStaff[0].userId,
      ORG_ID,
      "collections",
      expect.any(Array),
    );
    expect(mockInsertCard).toHaveBeenCalled();
  });

  it("skips (no-op) when no finance staff found", async () => {
    mockFindFinanceStaff.mockResolvedValue([]);
    await onExpedienteSentToFinance({ caseId: CASE_ID, orgId: ORG_ID });
    expect(mockInsertCard).not.toHaveBeenCalled();
  });

  it("creates cards for each finance staff member", async () => {
    const twoStaff = [
      { userId: "staff-1-uuid-4111-8111-111111111111", role: "finance" },
      { userId: "staff-2-uuid-4222-8222-222222222222", role: "finance" },
    ];
    mockFindFinanceStaff.mockResolvedValue(twoStaff);
    // Give each staff their own board
    mockFindBoard
      .mockResolvedValueOnce({ id: "board-staff-1", owner_staff_id: twoStaff[0].userId, board_kind: "collections" })
      .mockResolvedValueOnce({ id: "board-staff-2", owner_staff_id: twoStaff[1].userId, board_kind: "collections" });
    mockFindCardByRef.mockResolvedValue(null);
    mockListColumns.mockResolvedValue(collectionsColumns);

    await onExpedienteSentToFinance({ caseId: CASE_ID, orgId: ORG_ID });
    expect(mockInsertCard).toHaveBeenCalledTimes(2);
  });

  it("does not throw on internal error (catch-and-log pattern)", async () => {
    mockFindFinanceStaff.mockRejectedValue(new Error("DB exploded"));
    await expect(
      onExpedienteSentToFinance({ caseId: CASE_ID, orgId: ORG_ID }),
    ).resolves.toBeUndefined();
  });
});
