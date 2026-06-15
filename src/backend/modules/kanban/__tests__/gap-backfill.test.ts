/**
 * Kanban module — GAP-2: backfillCasesBoard (F5-Ola3)
 *
 * Covers:
 *  - enforces can(actor,'cases','view')
 *  - returns immediately when caseIds is empty (no DB calls)
 *  - creates board lazily when actor has no board yet
 *  - inserts card in entry column for each missing case
 *  - is idempotent: skips caseIds that already have a card on the board
 *  - skips only the caseIds that exist, inserts the rest (partial backfill)
 *  - uses the lowest-position column as entry column
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockFindBoard,
  mockCreateBoardWithSeed,
  mockListColumns,
  mockFindCardByRef,
  mockMaxCardPosition,
  mockInsertCard,
  mockCan,
} = vi.hoisted(() => ({
  mockFindBoard: vi.fn(),
  mockCreateBoardWithSeed: vi.fn(),
  mockListColumns: vi.fn(),
  mockFindCardByRef: vi.fn(),
  mockMaxCardPosition: vi.fn().mockResolvedValue(0),
  mockInsertCard: vi.fn().mockResolvedValue(undefined),
  mockCan: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  systemActor: vi.fn().mockReturnValue({ userId: "system", orgId: "system", role: "admin", kind: "staff" }),
  requireCaseAccess: vi.fn().mockResolvedValue(undefined),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn().mockResolvedValue({}),
  createServiceClient: vi.fn().mockReturnValue({
    channel: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({}) }),
  }),
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), on: vi.fn() },
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findBoard: mockFindBoard,
    createBoardWithSeed: mockCreateBoardWithSeed,
    listColumns: mockListColumns,
    findCardByRef: mockFindCardByRef,
    maxCardPosition: mockMaxCardPosition,
    insertCard: mockInsertCard,
    // Non-backfill functions — neutral mocks
    findCard: vi.fn().mockResolvedValue(null),
    findColumn: vi.fn().mockResolvedValue(null),
    updateCard: vi.fn().mockResolvedValue(null),
    listCards: vi.fn().mockResolvedValue([]),
    insertColumn: vi.fn().mockResolvedValue(null),
    updateColumn: vi.fn().mockResolvedValue(null),
    reorderColumns: vi.fn().mockResolvedValue(undefined),
    deleteColumn: vi.fn().mockResolvedValue(undefined),
    countCardsInColumn: vi.fn().mockResolvedValue(0),
    migrateCardsToColumn: vi.fn().mockResolvedValue(undefined),
    maxColumnPosition: vi.fn().mockResolvedValue(0),
    findLead: vi.fn().mockResolvedValue(null),
    insertLead: vi.fn().mockResolvedValue(null),
    updateLead: vi.fn().mockResolvedValue(null),
    findLeadsByLast4: vi.fn().mockResolvedValue([]),
    maxCategoryPosition: vi.fn().mockResolvedValue(0),
    insertLeadCategory: vi.fn().mockResolvedValue(null),
    findFinanceStaff: vi.fn().mockResolvedValue([]),
    deleteCardByRef: vi.fn().mockResolvedValue(undefined),
    deleteCard: vi.fn().mockResolvedValue(undefined),
    listLeads: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    maxTaskPosition: vi.fn().mockResolvedValue(0),
    findTask: vi.fn().mockResolvedValue(null),
    insertTask: vi.fn().mockResolvedValue(null),
    updateTask: vi.fn().mockResolvedValue(null),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    reorderTasks: vi.fn().mockResolvedValue(undefined),
    listTasks: vi.fn().mockResolvedValue([]),
  };
});

// Import AFTER mocks
import { backfillCasesBoard } from "../service";
import type { Actor } from "@/backend/platform/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR: Actor = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "paralegal",
  kind: "staff",
  permissions: new Map([["cases", { view: true, edit: true }]]),
};

const CASE_ID_1 = "11111111-1111-4111-8111-111111111111";
const CASE_ID_2 = "22222222-2222-4222-8222-222222222222";
const BOARD_ID = "board1111-1111-4111-8111-111111111111";
const COL_ENTRY_ID = "colentry1-1111-4111-8111-111111111111";

const makeBoard = () => ({
  id: BOARD_ID,
  owner_staff_id: ACTOR.userId,
  org_id: ACTOR.orgId,
  board_kind: "cases",
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
});

const makeColumns = () => [
  { id: COL_ENTRY_ID, board_id: BOARD_ID, label: "Por iniciar", position: 1, color: "gray", is_terminal_won: false, is_terminal_lost: false, created_at: "2026-06-01T00:00:00Z" },
  { id: "colid2222-2222-4222-8222-222222222222", board_id: BOARD_ID, label: "En progreso", position: 2, color: "blue", is_terminal_won: false, is_terminal_lost: false, created_at: "2026-06-01T00:00:00Z" },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("kanban: backfillCasesBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined); // authorized by default
    mockFindBoard.mockResolvedValue(makeBoard());
    mockCreateBoardWithSeed.mockResolvedValue(makeBoard());
    mockListColumns.mockResolvedValue(makeColumns());
    mockFindCardByRef.mockResolvedValue(null); // no existing card by default
    mockMaxCardPosition.mockResolvedValue(0);
    mockInsertCard.mockResolvedValue(undefined);
  });

  it("enforces can(actor,'cases','view')", async () => {
    mockCan.mockImplementation(() => { throw new Error("AUTHZ_DENIED"); });
    await expect(backfillCasesBoard(ACTOR, [CASE_ID_1])).rejects.toThrow("AUTHZ_DENIED");
  });

  it("returns immediately without DB calls when caseIds is empty", async () => {
    await backfillCasesBoard(ACTOR, []);
    expect(mockFindBoard).not.toHaveBeenCalled();
    expect(mockInsertCard).not.toHaveBeenCalled();
  });

  it("creates board lazily when actor has no cases board yet", async () => {
    mockFindBoard.mockResolvedValue(null);
    await backfillCasesBoard(ACTOR, [CASE_ID_1]);
    expect(mockCreateBoardWithSeed).toHaveBeenCalledWith(
      ACTOR.userId,
      ACTOR.orgId,
      "cases",
      expect.any(Array),
    );
  });

  it("inserts card in entry column for a missing case", async () => {
    await backfillCasesBoard(ACTOR, [CASE_ID_1]);
    expect(mockInsertCard).toHaveBeenCalledWith(
      expect.objectContaining({
        column_id: COL_ENTRY_ID,
        ref_type: "case",
        ref_id: CASE_ID_1,
      }),
    );
  });

  it("is idempotent: skips caseId that already has a card on the board", async () => {
    mockFindCardByRef.mockResolvedValue({ id: "existing-card", column_id: COL_ENTRY_ID });
    await backfillCasesBoard(ACTOR, [CASE_ID_1]);
    expect(mockInsertCard).not.toHaveBeenCalled();
  });

  it("partial backfill: inserts missing case, skips existing case", async () => {
    // CASE_ID_1 has a card; CASE_ID_2 does not
    mockFindCardByRef
      .mockResolvedValueOnce({ id: "card-for-case1", column_id: COL_ENTRY_ID }) // CASE_ID_1
      .mockResolvedValueOnce(null); // CASE_ID_2

    await backfillCasesBoard(ACTOR, [CASE_ID_1, CASE_ID_2]);

    expect(mockInsertCard).toHaveBeenCalledTimes(1);
    expect(mockInsertCard).toHaveBeenCalledWith(
      expect.objectContaining({ ref_id: CASE_ID_2 }),
    );
  });

  it("inserts all cases when none have cards yet", async () => {
    mockFindCardByRef.mockResolvedValue(null);
    await backfillCasesBoard(ACTOR, [CASE_ID_1, CASE_ID_2]);
    expect(mockInsertCard).toHaveBeenCalledTimes(2);
  });

  it("uses the lowest-position column as entry column", async () => {
    // Deliberately put higher-position column first in the array
    const shuffledCols = [
      { id: "col-high", board_id: BOARD_ID, label: "Terminado", position: 5, color: "green", is_terminal_won: true, is_terminal_lost: false, created_at: "2026-06-01T00:00:00Z" },
      { id: COL_ENTRY_ID, board_id: BOARD_ID, label: "Por iniciar", position: 1, color: "gray", is_terminal_won: false, is_terminal_lost: false, created_at: "2026-06-01T00:00:00Z" },
    ];
    mockListColumns.mockResolvedValue(shuffledCols);

    await backfillCasesBoard(ACTOR, [CASE_ID_1]);

    expect(mockInsertCard).toHaveBeenCalledWith(
      expect.objectContaining({ column_id: COL_ENTRY_ID }),
    );
  });

  it("does not reuse existing board for a different board_kind", async () => {
    // findBoard is called specifically for 'cases' kind
    await backfillCasesBoard(ACTOR, [CASE_ID_1]);
    expect(mockFindBoard).toHaveBeenCalledWith(ACTOR.userId, "cases");
  });
});
