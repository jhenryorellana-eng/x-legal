/**
 * Kanban consumers — F6-Ola2 unit tests.
 *
 * Covers:
 *  - onInstallmentOverdue: creates card in "Vencidas", moves if exists elsewhere, idempotent if already there
 *  - onExpedientePrinted: moves card to "Hecho", no-op if card doesn't exist, idempotent if already there
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
  mockUpdateCard,
  mockChannelSend,
} = vi.hoisted(() => ({
  mockFindFinanceStaff: vi.fn(),
  mockFindBoard: vi.fn(),
  mockCreateBoardWithSeed: vi.fn(),
  mockFindCardByRef: vi.fn(),
  mockListColumns: vi.fn(),
  mockMaxCardPosition: vi.fn().mockResolvedValue(0),
  mockInsertCard: vi.fn().mockResolvedValue({ id: "card-new" }),
  mockUpdateCard: vi.fn().mockResolvedValue({}),
  mockChannelSend: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  systemActor: () => ({
    userId: "00000000-0000-0000-0000-000000000000",
    orgId: "sys",
    role: "admin",
    kind: "staff",
  }),
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
  createServiceClient: vi.fn(() => ({
    channel: vi.fn(() => ({ send: mockChannelSend })),
  })),
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
  updateCard: mockUpdateCard,
  deleteCard: vi.fn().mockResolvedValue(undefined),
  moveCard: vi.fn().mockResolvedValue(undefined),
  maxCardPosition: mockMaxCardPosition,
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
import { onInstallmentOverdue, onExpedientePrinted } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASE_ID  = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOARD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EXPEDIENTE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const financeStaff = [
  { userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", role: "finance" },
];

const board = { id: BOARD_ID, owner_staff_id: financeStaff[0].userId, board_kind: "collections" };

const collectionsColumns = [
  { id: "col-1", board_id: BOARD_ID, label: "Por cobrar inicial", position: 1, color: "accent", is_terminal_won: false, is_terminal_lost: false },
  { id: "col-2", board_id: BOARD_ID, label: "Cuotas por vencer",  position: 2, color: "gold",   is_terminal_won: false, is_terminal_lost: false },
  { id: "col-3", board_id: BOARD_ID, label: "Vencidas",           position: 3, color: "red",    is_terminal_won: false, is_terminal_lost: false },
  { id: "col-4", board_id: BOARD_ID, label: "Por imprimir",       position: 4, color: "navy",   is_terminal_won: false, is_terminal_lost: false },
  { id: "col-5", board_id: BOARD_ID, label: "Hecho",              position: 5, color: "green",  is_terminal_won: true,  is_terminal_lost: false },
];

const overduePayload = {
  caseId: CASE_ID,
  orgId: ORG_ID,
  installmentId: "inst-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  number: 3,
  amountCents: 50000,
  dueDate: "2025-06-01",
  daysLate: 14,
};

const printedPayload = {
  caseId: CASE_ID,
  orgId: ORG_ID,
  expedienteId: EXPEDIENTE_ID,
  attemptNo: 1,
  printedAt: "2025-06-15T10:00:00Z",
  printedById: financeStaff[0].userId,
};

// ---------------------------------------------------------------------------
// onInstallmentOverdue tests
// ---------------------------------------------------------------------------

describe("kanban: onInstallmentOverdue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFinanceStaff.mockResolvedValue(financeStaff);
    mockFindBoard.mockResolvedValue(board);
    mockListColumns.mockResolvedValue(collectionsColumns);
    mockFindCardByRef.mockResolvedValue(null);
    mockMaxCardPosition.mockResolvedValue(0);
    mockInsertCard.mockResolvedValue({ id: "card-new" });
    mockCreateBoardWithSeed.mockResolvedValue(board);
    mockUpdateCard.mockResolvedValue({});
  });

  it("creates a card in the 'Vencidas' column when no card exists", async () => {
    await onInstallmentOverdue(overduePayload);
    expect(mockInsertCard).toHaveBeenCalledWith(
      expect.objectContaining({
        column_id: "col-3", // Vencidas
        ref_type: "case",
        ref_id: CASE_ID,
      }),
    );
  });

  it("moves card to 'Vencidas' when it exists in another column", async () => {
    // Card is currently in "Cuotas por vencer" (col-2)
    mockFindCardByRef.mockResolvedValue({
      id: "card-existing",
      column_id: "col-2",
      board_id: BOARD_ID,
    });
    await onInstallmentOverdue(overduePayload);
    expect(mockUpdateCard).toHaveBeenCalledWith(
      "card-existing",
      expect.objectContaining({ column_id: "col-3" }),
    );
    expect(mockInsertCard).not.toHaveBeenCalled();
  });

  it("is idempotent when card is already in 'Vencidas'", async () => {
    mockFindCardByRef.mockResolvedValue({
      id: "card-existing",
      column_id: "col-3", // already in Vencidas
      board_id: BOARD_ID,
    });
    await onInstallmentOverdue(overduePayload);
    expect(mockUpdateCard).not.toHaveBeenCalled();
    expect(mockInsertCard).not.toHaveBeenCalled();
  });

  it("skips (no-op) when no finance staff found", async () => {
    mockFindFinanceStaff.mockResolvedValue([]);
    await onInstallmentOverdue(overduePayload);
    expect(mockInsertCard).not.toHaveBeenCalled();
  });

  it("lazy-creates the board when not found", async () => {
    mockFindBoard.mockResolvedValue(null);
    mockCreateBoardWithSeed.mockResolvedValue(board);
    await onInstallmentOverdue(overduePayload);
    expect(mockCreateBoardWithSeed).toHaveBeenCalledWith(
      financeStaff[0].userId,
      ORG_ID,
      "collections",
      expect.any(Array),
    );
    expect(mockInsertCard).toHaveBeenCalled();
  });

  it("does not throw on internal error (catch-and-log pattern)", async () => {
    mockFindFinanceStaff.mockRejectedValue(new Error("DB exploded"));
    await expect(onInstallmentOverdue(overduePayload)).resolves.toBeUndefined();
  });

  it("creates cards for each finance staff member", async () => {
    const twoStaff = [
      { userId: "staff-1-uuid-4111-8111-111111111111", role: "finance" },
      { userId: "staff-2-uuid-4222-8222-222222222222", role: "finance" },
    ];
    mockFindFinanceStaff.mockResolvedValue(twoStaff);
    mockFindBoard
      .mockResolvedValueOnce({ id: "board-1", owner_staff_id: twoStaff[0].userId, board_kind: "collections" })
      .mockResolvedValueOnce({ id: "board-2", owner_staff_id: twoStaff[1].userId, board_kind: "collections" });
    mockFindCardByRef.mockResolvedValue(null);
    mockListColumns.mockResolvedValue(collectionsColumns);

    await onInstallmentOverdue(overduePayload);
    expect(mockInsertCard).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// onExpedientePrinted tests
// ---------------------------------------------------------------------------

describe("kanban: onExpedientePrinted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFinanceStaff.mockResolvedValue(financeStaff);
    mockFindBoard.mockResolvedValue(board);
    mockListColumns.mockResolvedValue(collectionsColumns);
    mockFindCardByRef.mockResolvedValue({
      id: "card-existing",
      column_id: "col-4", // in "Por imprimir"
      board_id: BOARD_ID,
    });
    mockUpdateCard.mockResolvedValue({});
    mockCreateBoardWithSeed.mockResolvedValue(board);
  });

  it("moves card to 'Hecho' when card exists on board", async () => {
    await onExpedientePrinted(printedPayload);
    expect(mockUpdateCard).toHaveBeenCalledWith(
      "card-existing",
      expect.objectContaining({ column_id: "col-5" }), // Hecho
    );
  });

  it("is a no-op when no card exists on board (RF-TRX-009 CA3)", async () => {
    mockFindCardByRef.mockResolvedValue(null);
    await onExpedientePrinted(printedPayload);
    expect(mockUpdateCard).not.toHaveBeenCalled();
    expect(mockInsertCard).not.toHaveBeenCalled();
  });

  it("is idempotent when card is already in 'Hecho'", async () => {
    mockFindCardByRef.mockResolvedValue({
      id: "card-existing",
      column_id: "col-5", // already in Hecho
      board_id: BOARD_ID,
    });
    await onExpedientePrinted(printedPayload);
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("is a no-op when board not found (no board for this staff)", async () => {
    mockFindBoard.mockResolvedValue(null);
    await onExpedientePrinted(printedPayload);
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("skips when no finance staff found", async () => {
    mockFindFinanceStaff.mockResolvedValue([]);
    await onExpedientePrinted(printedPayload);
    expect(mockUpdateCard).not.toHaveBeenCalled();
  });

  it("does not throw on internal error (catch-and-log pattern)", async () => {
    mockFindFinanceStaff.mockRejectedValue(new Error("DB exploded"));
    await expect(onExpedientePrinted(printedPayload)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// BLOCKER-2: broadcastCardMoved correctness in onInstallmentOverdue
// ---------------------------------------------------------------------------

describe("kanban: onInstallmentOverdue — BLOCKER-2 broadcast correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChannelSend.mockResolvedValue(undefined);

    mockFindFinanceStaff.mockResolvedValue(financeStaff);
    mockFindBoard.mockResolvedValue(board);
    mockListColumns.mockResolvedValue(collectionsColumns);
    mockMaxCardPosition.mockResolvedValue(3);
  });

  it("broadcast uses real card id (from insertCard) when creating a new card", async () => {
    mockFindCardByRef.mockResolvedValue(null);
    mockInsertCard.mockResolvedValue({ id: "card-real-id-from-db" });

    await onInstallmentOverdue(overduePayload);

    expect(mockChannelSend).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          card_id: "card-real-id-from-db", // must be card row id, NOT caseId
          from_column_id: "col-3",          // creation: from == to (Vencidas)
          to_column_id: "col-3",
          position: 4,                      // maxPos + 1 = 3 + 1
        }),
      }),
    );
  });

  it("broadcast uses real card id and correct from_column_id when moving existing card", async () => {
    // Card is in "Cuotas por vencer" (col-2) before being moved to Vencidas (col-3)
    mockFindCardByRef.mockResolvedValue({
      id: "card-existing-id",
      column_id: "col-2", // source column BEFORE move
      board_id: BOARD_ID,
    });
    mockUpdateCard.mockResolvedValue({});

    await onInstallmentOverdue(overduePayload);

    expect(mockChannelSend).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          card_id: "card-existing-id",   // real card row id (NOT caseId)
          from_column_id: "col-2",        // original column (NOT vencidasCol.id)
          to_column_id: "col-3",          // Vencidas
          position: 4,                    // maxPos + 1
        }),
      }),
    );
  });

  it("does NOT broadcast when card is already in Vencidas (no-op move)", async () => {
    mockFindCardByRef.mockResolvedValue({
      id: "card-already-in-vencidas",
      column_id: "col-3", // already in Vencidas
      board_id: BOARD_ID,
    });

    await onInstallmentOverdue(overduePayload);

    // No broadcast when card is already in the target column
    expect(mockChannelSend).not.toHaveBeenCalled();
  });
});
