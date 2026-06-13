/**
 * Kanban module — service layer (use cases).
 *
 * Authorization: can() is ALWAYS the first line of every staff use case.
 * Board owner guard: requireBoardOwnerOrAdmin() for card/column mutations.
 * Mutations: writeAudit() on every kanban/leads mutation (except staff_tasks).
 * Events: appEvents.emit() for domain events.
 * Realtime: broadcast to board:{id} after moveCard (DOC-25 §1.1).
 *
 * Cross-module calls: via cases/index.ts and identity/index.ts ONLY (rule R3).
 *
 * @module kanban/service
 */

import { can, systemActor, AuthzError } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { appEvents } from "@/backend/platform/events";
import { createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import { writeAudit } from "@/backend/modules/audit";

import {
  seedColumnsFor,
  moduleKeyForKind,
  isColumnLabelValid,
  isColumnColorValid,
  columnTerminalFlagsValid,
  isLeadPhoneShapeValid,
  findLeadDuplicates,
  type BoardKind,
  type ColumnColor,
} from "./domain";

import * as repo from "./repository";
import type { BoardRow, ColumnRow, CardRow, LeadRow, CategoryRow, TaskRow } from "./repository";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class KanbanError extends Error {
  constructor(
    public readonly code:
      | "BOARD_NOT_FOUND"
      | "BOARD_FORBIDDEN"
      | "COLUMN_NOT_FOUND"
      | "BOARD_COLUMN_NOT_EMPTY"
      | "BOARD_LAST_COLUMN"
      | "COLUMN_TARGET_INVALID"
      | "CARD_NOT_FOUND"
      | "CARD_DUPLICATE"
      | "CARD_REF_INVALID"
      | "LEAD_PHONE_INVALID"
      | "LEAD_LOST_REASON_REQUIRED"
      | "LEAD_NOT_WON"
      | "LEAD_CASE_ALREADY_CREATED"
      | "TASK_NOT_FOUND",
    public readonly meta?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "KanbanError";
  }
}

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface GetBoardInput {
  kind: BoardKind;
  ownerStaffId?: string; // admin-only override
}

export interface BoardDto {
  board: BoardRow;
  columns: ColumnRow[];
  cards: CardRow[];
}

export interface MoveCardInput {
  cardId: string;
  toColumnId: string;
  toPosition: number;
  lostReason?: string;
}

export interface CreateColumnInput {
  boardId: string;
  label: string;
  color: ColumnColor;
}

export interface UpdateColumnInput {
  columnId: string;
  label?: string;
  color?: ColumnColor;
  isTerminalWon?: boolean;
  isTerminalLost?: boolean;
}

export interface CreateLeadInput {
  phone: string;
  fullName?: string;
  source?: string;
  categoryId?: string;
  newCategory?: { label: string; color?: string };
  interestedServiceId?: string;
  note?: string;
  assignedToStaffId?: string; // defaults to actor.userId
  confirmDuplicate?: boolean;
}

export type CreateLeadResult =
  | { type: "lead"; lead: LeadRow }
  | { type: "warning"; code: "LEAD_DUPLICATE_WARNING"; exactMatches: Array<{ id: string; phoneE164: string; fullName: string | null }>; weakMatches: Array<{ id: string; phoneE164: string; fullName: string | null }> };

export interface UpdateLeadInput {
  leadId: string;
  fullName?: string;
  source?: string;
  categoryId?: string | null;
  interestedServiceId?: string | null;
  note?: string | null;
  assignedTo?: string;
  phone?: string;
  confirmDuplicate?: boolean;
}

export interface CreateLeadCategoryInput {
  label: string;
  color?: string;
}

export interface CreateCaseFromLeadInput {
  leadId: string;
  caseInput: Record<string, unknown>;
}

export interface ExpressServiceInterestInput {
  interestedServiceId: string;
  clientUserId: string;
  clientOrgId: string;
  assignedSalesStaffId?: string;
}

export interface CreateTaskInput {
  text: string;
  tag?: string;
  caseId?: string;
}

export interface UpdateTaskInput {
  taskId: string;
  text?: string;
  tag?: string | null;
  caseId?: string | null;
}

// ---------------------------------------------------------------------------
// Internal guards
// ---------------------------------------------------------------------------

function requireBoardOwnerOrAdmin(actor: Actor, board: BoardRow): void {
  if (actor.role !== "admin" && board.owner_staff_id !== actor.userId) {
    throw new KanbanError("BOARD_FORBIDDEN");
  }
}

function now(): Date {
  return new Date();
}

// ---------------------------------------------------------------------------
// Realtime broadcast helper (DOC-25 §1.1)
// ---------------------------------------------------------------------------

async function broadcastCardMoved(
  boardId: string,
  payload: {
    card_id: string;
    from_column_id: string;
    to_column_id: string;
    position: number;
    actor_user_id: string;
  },
): Promise<void> {
  try {
    const client = createServiceClient();
    // Use the Supabase realtime.send() / channel broadcast pattern
    await client
      .channel(`board:${boardId}`)
      .send({
        type: "broadcast",
        event: "card.moved",
        payload,
      });
  } catch (err) {
    // Broadcast failures are non-fatal (clients degrade to polling — DOC-25 §1.6)
    logger.warn({ err, boardId }, "kanban: realtime broadcast failed (non-fatal)");
  }
}

// ---------------------------------------------------------------------------
// API-KAN-01: getBoard — lazy-create + hydrate
// ---------------------------------------------------------------------------

/**
 * Returns the board for the actor (or ownerStaffId if admin).
 * Creates the board with seed columns if it doesn't exist yet (idempotent).
 *
 * @API-KAN-01
 */
export async function getBoard(
  actor: Actor,
  input: GetBoardInput,
): Promise<BoardDto> {
  can(actor, moduleKeyForKind(input.kind), "view");

  const ownerId =
    actor.role === "admin" && input.ownerStaffId
      ? input.ownerStaffId
      : actor.userId;

  let board = await repo.findBoard(ownerId, input.kind);

  if (!board) {
    board = await repo.createBoardWithSeed(
      ownerId,
      actor.orgId,
      input.kind,
      seedColumnsFor(input.kind),
    );
  }

  const [columns, cards] = await Promise.all([
    repo.listColumns(board.id),
    repo.listCards(board.id),
  ]);

  return { board, columns, cards };
}

// ---------------------------------------------------------------------------
// API-KAN-02: moveCard — transactional + broadcast
// ---------------------------------------------------------------------------

/**
 * Moves a kanban card to a new column+position.
 * On leads boards: applies terminal-column rules (won/lost), sets contacted_at.
 * Broadcasts card.moved to board:{boardId} after commit.
 * Emits card.moved domain event.
 *
 * @API-KAN-02
 */
export async function moveCard(
  actor: Actor,
  input: MoveCardInput,
): Promise<void> {
  const card = await repo.findCard(input.cardId);
  if (!card) throw new KanbanError("CARD_NOT_FOUND");

  const fromColumn = await repo.findColumn(card.column_id);
  if (!fromColumn) throw new KanbanError("COLUMN_NOT_FOUND");

  const toColumn = await repo.findColumn(input.toColumnId);
  if (!toColumn) throw new KanbanError("COLUMN_NOT_FOUND");

  // Load board to check ownership
  const client = createServiceClient();
  const { data: boardRow, error: boardErr } = await client
    .from("kanban_boards")
    .select("*")
    .eq("id", fromColumn.board_id)
    .maybeSingle();
  if (boardErr || !boardRow) throw new KanbanError("BOARD_NOT_FOUND");

  can(actor, moduleKeyForKind(boardRow.board_kind as BoardKind), "edit");
  requireBoardOwnerOrAdmin(actor, boardRow);

  // Validate destination column belongs to the same board
  if (toColumn.board_id !== boardRow.id) {
    throw new KanbanError("COLUMN_TARGET_INVALID");
  }

  // Update card position
  await repo.updateCard(input.cardId, {
    column_id: input.toColumnId,
    position: input.toPosition,
  });

  // Leads-specific rules
  const isLeadsBoard = boardRow.board_kind === "leads";
  if (isLeadsBoard && card.ref_type === "lead") {
    const lead = await repo.findLead(card.ref_id);
    if (lead) {
      // contacted_at: set on first move out of entry column (if still null)
      const columns = await repo.listColumns(boardRow.id);
      const entryColumn = columns.reduce((min, c) =>
        c.position < min.position ? c : min,
      );
      if (
        fromColumn.id === entryColumn.id &&
        lead.contacted_at === null
      ) {
        await repo.updateLead(card.ref_id, {
          contacted_at: now().toISOString(),
        });
      }

      // Terminal won/lost
      if (toColumn.is_terminal_won) {
        await markLeadWonInternal(actor, lead);
      } else if (toColumn.is_terminal_lost) {
        await markLeadLostInternal(actor, lead, input.lostReason);
      }
    }
  }

  await writeAudit(
    actor,
    "kanban.card.moved",
    "kanban_cards",
    input.cardId,
    {
      before: { column_id: fromColumn.id, position: card.position },
      after: { column_id: input.toColumnId, position: input.toPosition },
    },
  );

  // Emit domain event
  appEvents.emit({
    type: "card.moved",
    payload: {
      boardId: boardRow.id,
      boardKind: boardRow.board_kind as BoardKind,
      cardId: card.id,
      refType: card.ref_type as "lead" | "case",
      refId: card.ref_id,
      fromColumnId: fromColumn.id,
      toColumnId: input.toColumnId,
      position: input.toPosition,
      actorUserId: actor.userId,
    },
    occurredAt: now(),
  });

  // Realtime broadcast (after commit — fire-and-forget)
  await broadcastCardMoved(boardRow.id, {
    card_id: card.id,
    from_column_id: fromColumn.id,
    to_column_id: input.toColumnId,
    position: input.toPosition,
    actor_user_id: actor.userId,
  });
}

// ---------------------------------------------------------------------------
// API-KAN-07: updateCardNote
// ---------------------------------------------------------------------------

/**
 * @API-KAN-07
 */
export async function updateCardNote(
  actor: Actor,
  input: { cardId: string; pinnedNote: string | null },
): Promise<CardRow> {
  const card = await repo.findCard(input.cardId);
  if (!card) throw new KanbanError("CARD_NOT_FOUND");

  const fromColumn = await repo.findColumn(card.column_id);
  if (!fromColumn) throw new KanbanError("COLUMN_NOT_FOUND");

  const client = createServiceClient();
  const { data: boardRow, error: boardErr } = await client
    .from("kanban_boards")
    .select("*")
    .eq("id", fromColumn.board_id)
    .maybeSingle();
  if (boardErr || !boardRow) throw new KanbanError("BOARD_NOT_FOUND");

  can(actor, moduleKeyForKind(boardRow.board_kind as BoardKind), "edit");
  requireBoardOwnerOrAdmin(actor, boardRow);

  const updated = await repo.updateCard(input.cardId, {
    pinned_note: input.pinnedNote,
  });

  await writeAudit(
    actor,
    "kanban.card.note_updated",
    "kanban_cards",
    input.cardId,
    { after: { pinned_note: input.pinnedNote } },
  );

  return updated;
}

// ---------------------------------------------------------------------------
// API-KAN-03: createColumn
// ---------------------------------------------------------------------------

/**
 * @API-KAN-03
 */
export async function createColumn(
  actor: Actor,
  input: CreateColumnInput,
): Promise<ColumnRow> {
  const board = await (async () => {
    const client = createServiceClient();
    const { data } = await client
      .from("kanban_boards")
      .select("*")
      .eq("id", input.boardId)
      .maybeSingle();
    return data;
  })();

  if (!board) throw new KanbanError("BOARD_NOT_FOUND");

  can(actor, moduleKeyForKind(board.board_kind as BoardKind), "edit");
  requireBoardOwnerOrAdmin(actor, board);

  if (!isColumnLabelValid(input.label)) {
    throw new Error("COLUMN_LABEL_INVALID");
  }
  if (!isColumnColorValid(input.color)) {
    throw new Error("COLUMN_COLOR_INVALID");
  }

  const maxPos = await repo.maxColumnPosition(input.boardId);
  const column = await repo.insertColumn({
    board_id: input.boardId,
    label: input.label,
    color: input.color,
    position: maxPos + 1,
    is_terminal_won: false,
    is_terminal_lost: false,
  });

  await writeAudit(
    actor,
    "kanban.column.created",
    "kanban_columns",
    column.id,
    { after: column },
  );

  return column;
}

// ---------------------------------------------------------------------------
// API-KAN-04: updateColumn
// ---------------------------------------------------------------------------

/**
 * @API-KAN-04
 */
export async function updateColumn(
  actor: Actor,
  input: UpdateColumnInput,
): Promise<ColumnRow> {
  const column = await repo.findColumn(input.columnId);
  if (!column) throw new KanbanError("COLUMN_NOT_FOUND");

  const client = createServiceClient();
  const { data: board } = await client
    .from("kanban_boards")
    .select("*")
    .eq("id", column.board_id)
    .maybeSingle();

  if (!board) throw new KanbanError("BOARD_NOT_FOUND");

  can(actor, moduleKeyForKind(board.board_kind as BoardKind), "edit");
  requireBoardOwnerOrAdmin(actor, board);

  if (input.label !== undefined && !isColumnLabelValid(input.label)) {
    throw new Error("COLUMN_LABEL_INVALID");
  }
  if (input.color !== undefined && !isColumnColorValid(input.color)) {
    throw new Error("COLUMN_COLOR_INVALID");
  }

  const newWon  = input.isTerminalWon  ?? column.is_terminal_won;
  const newLost = input.isTerminalLost ?? column.is_terminal_lost;

  if (!columnTerminalFlagsValid(newWon, newLost)) {
    throw new Error("COLUMN_TERMINAL_FLAGS_CONFLICT");
  }

  const update: Record<string, unknown> = {};
  if (input.label !== undefined) update.label = input.label;
  if (input.color !== undefined) update.color = input.color;
  if (input.isTerminalWon !== undefined) update.is_terminal_won = input.isTerminalWon;
  if (input.isTerminalLost !== undefined) update.is_terminal_lost = input.isTerminalLost;

  const updated = await repo.updateColumn(input.columnId, update);

  await writeAudit(
    actor,
    "kanban.column.updated",
    "kanban_columns",
    input.columnId,
    { before: column, after: updated },
  );

  return updated;
}

// ---------------------------------------------------------------------------
// API-KAN-05: reorderColumns
// ---------------------------------------------------------------------------

/**
 * @API-KAN-05
 */
export async function reorderColumns(
  actor: Actor,
  input: { boardId: string; orderedColumnIds: string[] },
): Promise<void> {
  const client = createServiceClient();
  const { data: board } = await client
    .from("kanban_boards")
    .select("*")
    .eq("id", input.boardId)
    .maybeSingle();

  if (!board) throw new KanbanError("BOARD_NOT_FOUND");

  can(actor, moduleKeyForKind(board.board_kind as BoardKind), "edit");
  requireBoardOwnerOrAdmin(actor, board);

  await repo.reorderColumns(input.boardId, input.orderedColumnIds);

  await writeAudit(
    actor,
    "kanban.column.reordered",
    "kanban_boards",
    input.boardId,
    { after: { orderedColumnIds: input.orderedColumnIds } },
  );
}

// ---------------------------------------------------------------------------
// API-KAN-06: deleteColumn
// ---------------------------------------------------------------------------

/**
 * Deletes a column.
 * - If the column has cards and no migrateToColumnId is provided → BOARD_COLUMN_NOT_EMPTY.
 * - If migrateToColumnId is provided → migrates cards first, then deletes.
 * - Protects the last column (BOARD_LAST_COLUMN).
 *
 * @API-KAN-06
 */
export async function deleteColumn(
  actor: Actor,
  input: { columnId: string; migrateToColumnId?: string },
): Promise<void> {
  const column = await repo.findColumn(input.columnId);
  if (!column) throw new KanbanError("COLUMN_NOT_FOUND");

  const client = createServiceClient();
  const { data: board } = await client
    .from("kanban_boards")
    .select("*")
    .eq("id", column.board_id)
    .maybeSingle();

  if (!board) throw new KanbanError("BOARD_NOT_FOUND");

  can(actor, moduleKeyForKind(board.board_kind as BoardKind), "edit");
  requireBoardOwnerOrAdmin(actor, board);

  // Guard: last column
  const allColumns = await repo.listColumns(column.board_id);
  if (allColumns.length <= 1) {
    throw new KanbanError("BOARD_LAST_COLUMN");
  }

  const cardCount = await repo.countCardsInColumn(input.columnId);

  if (cardCount > 0) {
    if (!input.migrateToColumnId) {
      throw new KanbanError("BOARD_COLUMN_NOT_EMPTY");
    }

    // Validate migration target
    const targetColumn = await repo.findColumn(input.migrateToColumnId);
    if (
      !targetColumn ||
      targetColumn.board_id !== column.board_id ||
      targetColumn.id === column.id
    ) {
      throw new KanbanError("COLUMN_TARGET_INVALID");
    }

    await repo.migrateCardsToColumn(input.columnId, input.migrateToColumnId);
  }

  await repo.deleteColumn(input.columnId);

  await writeAudit(
    actor,
    "kanban.column.deleted",
    "kanban_columns",
    input.columnId,
    { before: column },
  );
}

// ---------------------------------------------------------------------------
// API-LEAD-02: createLead
// ---------------------------------------------------------------------------

/**
 * Creates a new lead.
 * Normalizes phone via identity (imported dynamically to avoid circular deps).
 * Checks duplicates at 2 levels (non-blocking — returns warning if found).
 * Creates card on leads board entry column.
 * Emits lead.created.
 *
 * @API-LEAD-02
 */
export async function createLead(
  actor: Actor,
  input: CreateLeadInput,
): Promise<CreateLeadResult> {
  can(actor, "leads", "edit");

  // Normalize phone via identity module (R3)
  const { normalizePhoneE164 } = await import(
    "@/backend/modules/identity" as string
  ) as { normalizePhoneE164: (phone: string) => string | null };

  const normalizedPhone = normalizePhoneE164(input.phone);
  if (!normalizedPhone || !isLeadPhoneShapeValid(normalizedPhone)) {
    throw new KanbanError("LEAD_PHONE_INVALID");
  }

  // Duplicate check: query existing leads with same last-4
  const last4 = normalizedPhone.slice(-4);
  const existing = await repo.findLeadsByLast4(actor.orgId, last4);
  const candidates = existing.map((l) => ({
    id: l.id,
    phoneE164: l.phone_e164,
    fullName: l.full_name,
  }));

  const dupResult = findLeadDuplicates(normalizedPhone, candidates);

  if (dupResult.hasMatches && !input.confirmDuplicate) {
    return {
      type: "warning",
      code: "LEAD_DUPLICATE_WARNING",
      exactMatches: dupResult.exactMatches,
      weakMatches: dupResult.weakMatches,
    };
  }

  // Resolve or create category
  let categoryId: string | null = input.categoryId ?? null;
  if (!categoryId && input.newCategory) {
    const maxPos = await repo.maxCategoryPosition(actor.orgId);
    const cat = await repo.insertLeadCategory({
      org_id: actor.orgId,
      label: input.newCategory.label,
      color: input.newCategory.color ?? "accent",
      position: maxPos + 1,
    });
    categoryId = cat.id;
  }

  // Create lead
  const assignedTo = input.assignedToStaffId ?? actor.userId;
  const lead = await repo.insertLead({
    org_id: actor.orgId,
    phone_e164: normalizedPhone,
    full_name: input.fullName ?? null,
    source: input.source ?? "manual",
    category_id: categoryId,
    interested_service_id: input.interestedServiceId ?? null,
    note: input.note ?? null,
    assigned_to: assignedTo,
    status: "open",
  });

  // Create card on leads board entry column
  const board = await (async () => {
    let b = await repo.findBoard(assignedTo, "leads");
    if (!b) {
      b = await repo.createBoardWithSeed(
        assignedTo,
        actor.orgId,
        "leads",
        seedColumnsFor("leads"),
      );
    }
    return b;
  })();

  const columns = await repo.listColumns(board.id);
  const entryColumn = columns.reduce((min, c) =>
    c.position < min.position ? c : min,
  );

  const maxPos = await repo.maxCardPosition(entryColumn.id);
  await repo.insertCard({
    column_id: entryColumn.id,
    ref_type: "lead",
    ref_id: lead.id,
    position: maxPos + 1,
  });

  // Emit domain event
  appEvents.emit({
    type: "lead.created",
    payload: {
      leadId: lead.id,
      orgId: actor.orgId,
      assignedTo,
      source: lead.source,
    },
    occurredAt: now(),
  });

  await writeAudit(
    actor,
    "leads.lead.created",
    "leads",
    lead.id,
    { after: lead },
  );

  return { type: "lead", lead };
}

// ---------------------------------------------------------------------------
// API-LEAD-03: updateLead
// ---------------------------------------------------------------------------

/**
 * @API-LEAD-03
 */
export async function updateLead(
  actor: Actor,
  input: UpdateLeadInput,
): Promise<CreateLeadResult> {
  can(actor, "leads", "edit");

  const lead = await repo.findLead(input.leadId);
  if (!lead) throw new KanbanError("LEAD_PHONE_INVALID"); // reuse closest error; 404 by id

  const update: Record<string, unknown> = {};

  if (input.fullName !== undefined) update.full_name = input.fullName;
  if (input.source !== undefined) update.source = input.source;
  if (input.categoryId !== undefined) update.category_id = input.categoryId;
  if (input.interestedServiceId !== undefined) update.interested_service_id = input.interestedServiceId;
  if (input.note !== undefined) update.note = input.note;

  // Phone change: re-normalize + re-check duplicates
  if (input.phone !== undefined) {
    const { normalizePhoneE164 } = await import(
      "@/backend/modules/identity" as string
    ) as { normalizePhoneE164: (phone: string) => string | null };

    const normalizedPhone = normalizePhoneE164(input.phone);
    if (!normalizedPhone || !isLeadPhoneShapeValid(normalizedPhone)) {
      throw new KanbanError("LEAD_PHONE_INVALID");
    }

    if (normalizedPhone !== lead.phone_e164) {
      const last4 = normalizedPhone.slice(-4);
      const existing = await repo.findLeadsByLast4(actor.orgId, last4);
      const candidates = existing
        .filter((l) => l.id !== input.leadId)
        .map((l) => ({ id: l.id, phoneE164: l.phone_e164, fullName: l.full_name }));

      const dupResult = findLeadDuplicates(normalizedPhone, candidates);

      if (dupResult.hasMatches && !input.confirmDuplicate) {
        return {
          type: "warning",
          code: "LEAD_DUPLICATE_WARNING",
          exactMatches: dupResult.exactMatches,
          weakMatches: dupResult.weakMatches,
        };
      }
    }

    update.phone_e164 = normalizedPhone;
  }

  // Reassignment: move card to new staff board
  if (input.assignedTo !== undefined && input.assignedTo !== lead.assigned_to) {
    update.assigned_to = input.assignedTo;

    // Remove card from current board
    if (lead.assigned_to) {
      const oldBoard = await repo.findBoard(lead.assigned_to, "leads");
      if (oldBoard) {
        await repo.deleteCardByRef(oldBoard.id, "lead", lead.id);
      }
    }

    // Add card to new staff board
    const newBoard = await (async () => {
      let b = await repo.findBoard(input.assignedTo!, "leads");
      if (!b) {
        b = await repo.createBoardWithSeed(
          input.assignedTo!,
          actor.orgId,
          "leads",
          seedColumnsFor("leads"),
        );
      }
      return b;
    })();

    const newCols = await repo.listColumns(newBoard.id);
    const entryCol = newCols.reduce((min, c) =>
      c.position < min.position ? c : min,
    );
    const maxPos = await repo.maxCardPosition(entryCol.id);
    await repo.insertCard({
      column_id: entryCol.id,
      ref_type: "lead",
      ref_id: lead.id,
      position: maxPos + 1,
    });
  }

  const updated = await repo.updateLead(input.leadId, update);

  await writeAudit(
    actor,
    "leads.lead.updated",
    "leads",
    input.leadId,
    { before: lead, after: updated },
  );

  return { type: "lead", lead: updated };
}

// ---------------------------------------------------------------------------
// API-LEAD-04: markLeadWon
// ---------------------------------------------------------------------------

/**
 * Idempotent: if already won, no event is re-emitted.
 *
 * @API-LEAD-04
 */
export async function markLeadWon(actor: Actor, leadId: string): Promise<LeadRow> {
  can(actor, "leads", "edit");
  const lead = await repo.findLead(leadId);
  if (!lead) throw new KanbanError("LEAD_PHONE_INVALID");
  return markLeadWonInternal(actor, lead);
}

async function markLeadWonInternal(actor: Actor, lead: LeadRow): Promise<LeadRow> {
  if (lead.status === "won") return lead; // idempotent: no re-emission

  const updated = await repo.updateLead(lead.id, { status: "won" });

  appEvents.emit({
    type: "lead.won",
    payload: {
      leadId: lead.id,
      orgId: lead.org_id,
      assignedTo: lead.assigned_to,
    },
    occurredAt: now(),
  });

  await writeAudit(actor, "leads.lead.won", "leads", lead.id, {
    before: { status: lead.status },
    after: { status: "won" },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// API-LEAD-05: markLeadLost
// ---------------------------------------------------------------------------

/**
 * Requires lostReason. Idempotent if already lost.
 *
 * @API-LEAD-05
 */
export async function markLeadLost(
  actor: Actor,
  leadId: string,
  lostReason: string,
): Promise<LeadRow> {
  can(actor, "leads", "edit");

  if (!lostReason?.trim()) {
    throw new KanbanError("LEAD_LOST_REASON_REQUIRED");
  }

  const lead = await repo.findLead(leadId);
  if (!lead) throw new KanbanError("LEAD_PHONE_INVALID");

  return markLeadLostInternal(actor, lead, lostReason);
}

async function markLeadLostInternal(
  actor: Actor,
  lead: LeadRow,
  lostReason: string | undefined,
): Promise<LeadRow> {
  if (!lostReason?.trim()) {
    throw new KanbanError("LEAD_LOST_REASON_REQUIRED");
  }

  if (lead.status === "lost") return lead; // idempotent

  const updated = await repo.updateLead(lead.id, {
    status: "lost",
    lost_reason: lostReason,
  });

  appEvents.emit({
    type: "lead.lost",
    payload: {
      leadId: lead.id,
      orgId: lead.org_id,
      lostReason,
    },
    occurredAt: now(),
  });

  await writeAudit(actor, "leads.lead.lost", "leads", lead.id, {
    before: { status: lead.status },
    after: { status: "lost", lost_reason: lostReason },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// API-LEAD-06: createCaseFromLead
// ---------------------------------------------------------------------------

/**
 * Delegates case creation to cases.createCaseFromContract via index.ts (R3).
 * Sets leads.won_case_id after successful creation.
 * Idempotent: returns existing case if already created (LEAD_CASE_ALREADY_CREATED).
 *
 * @API-LEAD-06
 */
export async function createCaseFromLead(
  actor: Actor,
  input: CreateCaseFromLeadInput,
): Promise<{ caseId: string; contractId: string }> {
  can(actor, "leads", "edit");

  const lead = await repo.findLead(input.leadId);
  if (!lead) throw new KanbanError("LEAD_PHONE_INVALID");

  if (lead.status !== "won") {
    throw new KanbanError("LEAD_NOT_WON");
  }

  if (lead.won_case_id !== null) {
    throw new KanbanError("LEAD_CASE_ALREADY_CREATED", {
      caseId: lead.won_case_id,
    });
  }

  // Delegate to cases module (R3)
  const casesModule = await import(
    "@/backend/modules/cases" as string
  ) as { createCaseFromContract: (actor: Actor, input: Record<string, unknown>) => Promise<{ caseId: string; contractId: string }> };

  const result = await casesModule.createCaseFromContract(actor, {
    ...input.caseInput,
    leadId: input.leadId,
  });

  // Link lead → case
  await repo.updateLead(input.leadId, { won_case_id: result.caseId });

  return result;
}

// ---------------------------------------------------------------------------
// API-LEAD-07: createLeadCategory
// ---------------------------------------------------------------------------

/**
 * @API-LEAD-07
 */
export async function createLeadCategory(
  actor: Actor,
  input: CreateLeadCategoryInput,
): Promise<CategoryRow> {
  can(actor, "leads", "edit");

  const maxPos = await repo.maxCategoryPosition(actor.orgId);
  const cat = await repo.insertLeadCategory({
    org_id: actor.orgId,
    label: input.label,
    color: input.color ?? "accent",
    position: maxPos + 1,
  });

  return cat;
}

// ---------------------------------------------------------------------------
// API-LEAD-08: expressServiceInterest (public/client CTA)
// ---------------------------------------------------------------------------

/**
 * Called from the client-facing catalog CTA "Me interesa".
 * Creates a lead with source='app', assigned to the default sales staff.
 * No auth guard here (actor is the client, not staff).
 *
 * @API-LEAD-08
 */
export async function expressServiceInterest(
  input: ExpressServiceInterestInput,
): Promise<{ created: boolean }> {
  const Zod = await import("zod");
  const schema = Zod.z.object({
    interestedServiceId: Zod.z.string().uuid(),
    clientUserId: Zod.z.string().uuid(),
    clientOrgId: Zod.z.string().uuid(),
    assignedSalesStaffId: Zod.z.string().uuid().optional(),
  });
  schema.parse(input);

  // Check for recent duplicate (same client + service in the last 7 days)
  const client = createServiceClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await client
    .from("leads")
    .select("id")
    .eq("org_id", input.clientOrgId)
    .eq("interested_service_id", input.interestedServiceId)
    .gte("created_at", sevenDaysAgo)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Aviso "ya en proceso de contacto" — not an error
    return { created: false };
  }

  // Resolve client phone from users table (needed for lead phone field)
  const { data: userRow } = await client
    .from("users")
    .select("phone_e164")
    .eq("id", input.clientUserId)
    .maybeSingle();

  const phone = userRow?.phone_e164 ?? "+10000000000"; // placeholder if no phone

  const { normalizePhoneE164 } = await import(
    "@/backend/modules/identity" as string
  ) as { normalizePhoneE164: (phone: string) => string | null };

  const normalizedPhone = normalizePhoneE164(phone) ?? phone;

  // Resolve default sales staff if not provided
  // staff_profiles has no org_id — join via users (org_id lives on users table)
  let assignedTo = input.assignedSalesStaffId;
  if (!assignedTo) {
    // Step 1: get all active staff in org
    const { data: orgUsers } = await client
      .from("users")
      .select("id")
      .eq("org_id", input.clientOrgId)
      .eq("kind", "staff")
      .eq("is_active", true);

    const orgUserIds = (orgUsers ?? []).map((u) => u.id);

    // Step 2: find one with role=sales
    if (orgUserIds.length > 0) {
      const { data: salesStaff } = await client
        .from("staff_profiles")
        .select("user_id")
        .in("user_id", orgUserIds)
        .eq("role", "sales")
        .limit(1)
        .maybeSingle();
      assignedTo = salesStaff?.user_id;
    }
  }

  if (!assignedTo) {
    logger.warn({ clientOrgId: input.clientOrgId }, "kanban: expressServiceInterest — no sales staff found");
    return { created: false };
  }

  const lead = await repo.insertLead({
    org_id: input.clientOrgId,
    phone_e164: normalizedPhone,
    source: "app",
    interested_service_id: input.interestedServiceId,
    assigned_to: assignedTo,
    status: "open",
  });

  // Card on entry column
  let board = await repo.findBoard(assignedTo, "leads");
  if (!board) {
    board = await repo.createBoardWithSeed(
      assignedTo,
      input.clientOrgId,
      "leads",
      seedColumnsFor("leads"),
    );
  }
  const cols = await repo.listColumns(board.id);
  const entryCol = cols.reduce((min, c) => c.position < min.position ? c : min);
  const maxPos = await repo.maxCardPosition(entryCol.id);
  await repo.insertCard({
    column_id: entryCol.id,
    ref_type: "lead",
    ref_id: lead.id,
    position: maxPos + 1,
  });

  appEvents.emit({
    type: "lead.created",
    payload: {
      leadId: lead.id,
      orgId: input.clientOrgId,
      assignedTo,
      source: "app",
    },
    occurredAt: now(),
  });

  return { created: true };
}

// ---------------------------------------------------------------------------
// listLeads — API-LEAD-01
// ---------------------------------------------------------------------------

/**
 * @API-LEAD-01
 */
export async function listLeads(
  actor: Actor,
  filters: {
    source?: string;
    categoryId?: string;
    serviceId?: string;
    uncontacted?: boolean;
    cursor?: string;
    limit?: number;
  },
) {
  can(actor, "leads", "view");
  return repo.listLeads(actor.orgId, filters);
}

// ---------------------------------------------------------------------------
// Staff tasks (§3.9) — API-KAN-08..12
// ---------------------------------------------------------------------------

/**
 * @API-KAN-08
 */
export async function createTask(
  actor: Actor,
  input: CreateTaskInput,
): Promise<TaskRow> {
  // staff_tasks are personal — no module can() check (dueño guard only, RLS refuerza)
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");

  if (!input.text?.trim()) throw new Error("TASK_TEXT_REQUIRED");

  const maxPos = await repo.maxTaskPosition(actor.userId);
  return repo.insertTask({
    staff_id: actor.userId,
    text: input.text.trim(),
    tag: input.tag ?? null,
    case_id: input.caseId ?? null,
    position: maxPos + 1,
  });
}

/**
 * @API-KAN-09
 */
export async function toggleTaskDone(
  actor: Actor,
  taskId: string,
): Promise<TaskRow> {
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");

  const task = await repo.findTask(taskId);
  if (!task || task.staff_id !== actor.userId) {
    throw new KanbanError("TASK_NOT_FOUND");
  }

  const doneAt = task.done_at ? null : now().toISOString();
  return repo.updateTask(taskId, { done_at: doneAt });
}

/**
 * @API-KAN-10
 */
export async function updateTask(
  actor: Actor,
  input: UpdateTaskInput,
): Promise<TaskRow> {
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");

  const task = await repo.findTask(input.taskId);
  if (!task || task.staff_id !== actor.userId) {
    throw new KanbanError("TASK_NOT_FOUND");
  }

  const update: Record<string, unknown> = {};
  if (input.text !== undefined) update.text = input.text.trim();
  if (input.tag !== undefined) update.tag = input.tag;
  if (input.caseId !== undefined) update.case_id = input.caseId;

  return repo.updateTask(input.taskId, update);
}

/**
 * @API-KAN-11
 */
export async function deleteTask(actor: Actor, taskId: string): Promise<void> {
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");

  const task = await repo.findTask(taskId);
  if (!task || task.staff_id !== actor.userId) {
    throw new KanbanError("TASK_NOT_FOUND");
  }

  await repo.deleteTask(taskId);
}

/**
 * @API-KAN-12
 */
export async function reorderTasks(
  actor: Actor,
  input: { orderedTaskIds: string[] },
): Promise<void> {
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");
  await repo.reorderTasks(actor.userId, input.orderedTaskIds);
}

/**
 * Lists my tasks (open by default, or including done).
 */
export async function listMyTasks(
  actor: Actor,
  options?: { includeDone?: boolean },
): Promise<TaskRow[]> {
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");
  return repo.listTasks(actor.userId, options?.includeDone ?? false);
}

// ---------------------------------------------------------------------------
// Automatic card listeners (§3.8) — internal helpers for register-consumers.ts
// ---------------------------------------------------------------------------

/**
 * Handles case.assigned → create card on cases board of the assigned paralegal.
 * Idempotent: if a card already exists for this case on the board, skip creation.
 */
export async function onCaseAssigned(payload: {
  caseId: string;
  assignedParalegalId: string;
  orgId: string;
  previousParalegalId?: string;
}): Promise<void> {
  try {
    const actor = systemActor();
    const { assignedParalegalId, caseId, orgId, previousParalegalId } = payload;

    // Remove card from previous paralegal's board (reasignment)
    if (previousParalegalId) {
      const prevBoard = await repo.findBoard(previousParalegalId, "cases");
      if (prevBoard) {
        await repo.deleteCardByRef(prevBoard.id, "case", caseId);
      }
    }

    // Find or create board for new paralegal
    let board = await repo.findBoard(assignedParalegalId, "cases");
    if (!board) {
      board = await repo.createBoardWithSeed(
        assignedParalegalId,
        orgId,
        "cases",
        seedColumnsFor("cases"),
      );
    }

    // Idempotent: skip if card already exists
    const existing = await repo.findCardByRef(board.id, "case", caseId);
    if (existing) return;

    // Find entry column ("Por iniciar" — position 1)
    const columns = await repo.listColumns(board.id);
    const entryCol = columns.reduce((min, c) =>
      c.position < min.position ? c : min,
    );

    const maxPos = await repo.maxCardPosition(entryCol.id);
    await repo.insertCard({
      column_id: entryCol.id,
      ref_type: "case",
      ref_id: caseId,
      position: maxPos + 1,
    });

    logger.info({ caseId, assignedParalegalId }, "kanban: case.assigned card created");

    // Broadcast to paralegal's board
    await broadcastCardMoved(board.id, {
      card_id: caseId,
      from_column_id: entryCol.id,
      to_column_id: entryCol.id,
      position: maxPos + 1,
      actor_user_id: actor.userId,
    });
  } catch (err) {
    logger.error({ err, payload }, "kanban: onCaseAssigned failed");
  }
}

/**
 * Handles contract.signed → create card on collections board (finance staff).
 * Idempotent.
 */
export async function onContractSigned(payload: {
  caseId: string;
  orgId: string;
}): Promise<void> {
  try {
    const { caseId, orgId } = payload;

    const financeStaff = await repo.findFinanceStaff(orgId);
    if (financeStaff.length === 0) {
      logger.warn({ orgId }, "kanban: onContractSigned — no finance staff found");
      return;
    }

    for (const staff of financeStaff) {
      let board = await repo.findBoard(staff.userId, "collections");
      if (!board) {
        board = await repo.createBoardWithSeed(
          staff.userId,
          orgId,
          "collections",
          seedColumnsFor("collections"),
        );
      }

      const existing = await repo.findCardByRef(board.id, "case", caseId);
      if (existing) continue;

      const columns = await repo.listColumns(board.id);
      const entryCol = columns.reduce((min, c) =>
        c.position < min.position ? c : min,
      );

      const maxPos = await repo.maxCardPosition(entryCol.id);
      await repo.insertCard({
        column_id: entryCol.id,
        ref_type: "case",
        ref_id: caseId,
        position: maxPos + 1,
      });

      logger.info({ caseId, staffId: staff.userId }, "kanban: contract.signed card created");

      await broadcastCardMoved(board.id, {
        card_id: caseId,
        from_column_id: entryCol.id,
        to_column_id: entryCol.id,
        position: maxPos + 1,
        actor_user_id: systemActor().userId,
      });
    }
  } catch (err) {
    logger.error({ err, payload }, "kanban: onContractSigned failed");
  }
}

/**
 * Handles downpayment.confirmed → remove card from "Por cobrar inicial" if still there.
 * If Andrium moved it already → no-op. Does NOT create cards.
 */
export async function onDownpaymentConfirmedKanban(payload: {
  caseId: string;
  orgId: string;
}): Promise<void> {
  try {
    const { caseId, orgId } = payload;

    const financeStaff = await repo.findFinanceStaff(orgId);
    for (const staff of financeStaff) {
      const board = await repo.findBoard(staff.userId, "collections");
      if (!board) continue;

      const card = await repo.findCardByRef(board.id, "case", caseId);
      if (!card) continue;

      // Only remove if still on entry column ("Por cobrar inicial")
      const columns = await repo.listColumns(board.id);
      const entryCol = columns.reduce((min, c) =>
        c.position < min.position ? c : min,
      );

      if (card.column_id === entryCol.id) {
        await repo.deleteCard(card.id);
        logger.info({ caseId, staffId: staff.userId }, "kanban: downpayment.confirmed card removed");
      }
    }
  } catch (err) {
    logger.error({ err, payload }, "kanban: onDownpaymentConfirmedKanban failed");
  }
}
