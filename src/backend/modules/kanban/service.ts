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
      | "LEAD_NOT_FOUND"
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

  const [initialColumns, cards] = await Promise.all([
    repo.listColumns(board.id),
    repo.listCards(board.id),
  ]);

  // Self-heal: a board must never be column-less. If an earlier failed seed left
  // it empty, re-seed now and re-read (idempotent).
  let columns = initialColumns;
  if (columns.length === 0) {
    await repo.seedBoardColumns(board.id, seedColumnsFor(input.kind));
    columns = await repo.listColumns(board.id);
  }

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

  // H-3 — Ordering invariant (non-transactional divergence mitigation):
  //   Read the lead BEFORE the card move so we have a consistent snapshot
  //   of its state regardless of where in the sequence an error occurs.
  //
  //   Order chosen for minimum silent data loss:
  //     1. Lead side effects first (contacted_at, won/lost status) — these
  //        are the business-critical writes. If they fail, the card is still
  //        in its original column (visible inconsistency, recoverable).
  //     2. Card position update — if this fails after step 1, the lead state
  //        is updated but the card is still in the source column. Support can
  //        see and correct the card; the lead status is never silently wrong.
  //     3. Audit log — non-fatal; a missing audit entry is better than a
  //        missing lead state change.
  //     4. Domain event + Realtime broadcast — emitted ONLY after all DB
  //        writes succeed. This prevents downstream consumers from acting on
  //        state that was never actually persisted.
  //
  // Ideal fix: a Postgres RPC (move_card_tx) wrapping steps 1+2 in a single
  // BEGIN/COMMIT. See migration 0016_scheduling_rpcs.sql (apply via orchestrator).

  // Pre-read lead if this is a leads board card
  const isLeadsBoard = boardRow.board_kind === "leads";
  let lead: LeadRow | null = null;
  if (isLeadsBoard && card.ref_type === "lead") {
    lead = await repo.findLead(card.ref_id);
  }

  // Step 1 — Lead side effects (contacted_at, won/lost)
  if (lead) {
    const columns = await repo.listColumns(boardRow.id);
    const entryColumn = columns.reduce((min, c) =>
      c.position < min.position ? c : min,
    );
    if (fromColumn.id === entryColumn.id && lead.contacted_at === null) {
      await repo.updateLead(card.ref_id, {
        contacted_at: now().toISOString(),
      });
    }

    if (toColumn.is_terminal_won) {
      await markLeadWonInternal(actor, lead);
    } else if (toColumn.is_terminal_lost) {
      await markLeadLostInternal(actor, lead, input.lostReason);
    }
  }

  // Step 2 — Update card position
  await repo.updateCard(input.cardId, {
    column_id: input.toColumnId,
    position: input.toPosition,
  });

  // Step 3 — Audit log
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

  // Step 4 — Domain event + Realtime broadcast (post-commit, fire-and-forget)
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

  // Realtime broadcast (after all writes — fire-and-forget)
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
  if (!lead) throw new KanbanError("LEAD_NOT_FOUND");

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
  if (!lead) throw new KanbanError("LEAD_NOT_FOUND");
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
  if (!lead) throw new KanbanError("LEAD_NOT_FOUND");

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
  if (!lead) throw new KanbanError("LEAD_NOT_FOUND");

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
): Promise<{ created: boolean; reason?: string }> {
  const Zod = await import("zod");
  const schema = Zod.z.object({
    interestedServiceId: Zod.z.string().uuid(),
    clientUserId: Zod.z.string().uuid(),
    clientOrgId: Zod.z.string().uuid(),
    assignedSalesStaffId: Zod.z.string().uuid().optional(),
  });
  schema.parse(input);

  const client = createServiceClient();

  // C-2(a): Validate clientUserId belongs to clientOrgId.
  // A mismatch means the caller is trying to create a lead on behalf of a user
  // in a different org — reject it. Anti-enumeration: same error shape as not-found.
  const { data: clientUserRow } = await client
    .from("users")
    .select("org_id, phone_e164")
    .eq("id", input.clientUserId)
    .maybeSingle();

  if (!clientUserRow || clientUserRow.org_id !== input.clientOrgId) {
    logger.warn(
      { clientUserId: input.clientUserId, clientOrgId: input.clientOrgId },
      "kanban: expressServiceInterest — clientUserId/clientOrgId mismatch or user not found",
    );
    return { created: false, reason: "org_mismatch" };
  }

  // C-2(c): If the user has no phone, we cannot create a lead (phone_e164 is NOT NULL).
  // Return no_phone instead of inventing a placeholder that would pollute real data.
  if (!clientUserRow.phone_e164) {
    return { created: false, reason: "no_phone" };
  }

  const phone = clientUserRow.phone_e164;

  // Check for recent duplicate (same client + service in the last 7 days)
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

// ---------------------------------------------------------------------------
// Sales metrics aggregations (DOC-52 §6.2) — API-MET-01
// ---------------------------------------------------------------------------

export type MetricsPeriod = "week" | "month" | "custom";

export interface SalesMetricsInput {
  period: MetricsPeriod;
  /** ISO date string; required when period="custom". Defaults to 7-day lookback. */
  from?: string;
  to?: string;
}

/**
 * Funnel stage counts (DOC-52 §6.2):
 *  stage0 = leads created in period
 *  stage1 = leads with contacted_at (contacted)
 *  stage2 = leads with won_case_id or status="won" (converted to case/appointment booked)
 *  stage3 = completed appointments of the actor in period
 *  stage4 = contracts signed (via cases assigned to actor) in period
 *  stage5 = cases with assigned_paralegal_id set (transferred to Diana)
 */
export interface FunnelCounts {
  stage0: number; // Leads
  stage1: number; // Contactados
  stage2: number; // Cita agendada
  stage3: number; // Cita asistida
  stage4: number; // Contrato
  stage5: number; // Traspasado
}

export interface WeekActivityBar {
  dayLabel: string;   // "L" / "M" / "X" / "J" / "V" / "S" / "D" (ISO weekday 1=Mon)
  dayIso: string;     // "YYYY-MM-DD"
  count: number;      // total lead + appointment activities
}

export interface SourceMetric {
  source: string;
  total: number;
  won: number;
}

export interface SalesMetricsResult {
  /** Leads created in period (for KPI). */
  newLeadsCount: number;
  /** Contracts signed (cierres) in period. */
  closuresCount: number;
  /** Cases ready to transfer (assigned_paralegal_id NOT null, period-agnostic for this actor). */
  readyForDianaCount: number;
  /** Conversion: closures / newLeads (null if 0 leads). */
  conversionPct: number | null;
  /** Previous period counts for trend deltas. */
  prevClosuresCount: number;
  prevNewLeadsCount: number;
  /** Funnel stage counts. */
  funnel: FunnelCounts;
  /** Per-day activity bars for the period (7 days for week, 28-31 for month). */
  weekBars: WeekActivityBar[];
  /** Leads grouped by source with conversion rate. */
  sources: SourceMetric[];
  /** Appointment attendance: completed / (completed + no_show). null if 0 denominator. */
  attendancePct: number | null;
  /** Rescheduled appointments count in period. */
  rescheduledCount: number;
  /** Median minutes from lead created_at → contacted_at (null if < 3 leads). */
  medianContactMinutes: number | null;
}

/**
 * Computes the [from, to) UTC date range for a given period.
 */
function periodRange(input: SalesMetricsInput): { from: Date; to: Date; prevFrom: Date; prevTo: Date } {
  const now = new Date();
  let from: Date;
  let to: Date = now;

  if (input.period === "week") {
    from = new Date(now.getTime() - 7 * 86_400_000);
  } else if (input.period === "month") {
    from = new Date(now.getTime() - 28 * 86_400_000);
  } else {
    // custom
    from = input.from ? new Date(input.from) : new Date(now.getTime() - 7 * 86_400_000);
    to   = input.to   ? new Date(input.to)   : now;
  }

  const span = to.getTime() - from.getTime();
  const prevTo   = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - span);

  return { from, to, prevFrom, prevTo };
}

/**
 * Returns the median of a numeric array (null if < 3 values per DOC-52 §6.2 A1).
 */
function median(values: number[]): number | null {
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Aggregates sales metrics for the given actor and period (DOC-52 §6.2).
 *
 * All queries use createServiceClient (service_role) for org-scoped reads;
 * filtering by actor.userId / actor.orgId provides the actor-scoping without
 * relying on RLS (this is a server-only RSC read, never exposed client-side).
 *
 * @api-id API-MET-01
 */
export async function getSalesMetrics(
  actor: Actor,
  input: SalesMetricsInput,
): Promise<SalesMetricsResult> {
  can(actor, "metrics", "view");

  const { from, to, prevFrom, prevTo } = periodRange(input);
  const fromIso = from.toISOString();
  const toIso   = to.toISOString();
  const prevFromIso = prevFrom.toISOString();
  const prevToIso   = prevTo.toISOString();

  const client = createServiceClient();

  // ─── Parallel reads ───────────────────────────────────────────────────────

  const [
    leadsRes,
    prevLeadsRes,
    contractsRes,
    prevContractsRes,
    readyForDianaRes,
    apptCurrRes,
  ] = await Promise.all([
    // Current period leads assigned to this actor
    client
      .from("leads")
      .select("id, contacted_at, won_case_id, status, source, created_at")
      .eq("org_id", actor.orgId)
      .eq("assigned_to", actor.userId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso),

    // Previous period leads (for trend)
    client
      .from("leads")
      .select("id")
      .eq("org_id", actor.orgId)
      .eq("assigned_to", actor.userId)
      .gte("created_at", prevFromIso)
      .lt("created_at", prevToIso),

    // Contracts signed in current period (via cases assigned to actor)
    client
      .from("contracts")
      .select("id, signed_at, case_id")
      .eq("org_id", actor.orgId)
      .not("signed_at", "is", null)
      .gte("signed_at", fromIso)
      .lt("signed_at", toIso),

    // Previous period contracts signed
    client
      .from("contracts")
      .select("id, case_id")
      .eq("org_id", actor.orgId)
      .not("signed_at", "is", null)
      .gte("signed_at", prevFromIso)
      .lt("signed_at", prevToIso),

    // Cases assigned to this actor with a paralegal assigned (ready/transferred)
    client
      .from("cases")
      .select("id")
      .eq("org_id", actor.orgId)
      .eq("assigned_sales_id", actor.userId)
      .not("assigned_paralegal_id", "is", null),

    // Appointments for this staff in current period (scheduled/completed/no_show/rescheduled)
    client
      .from("appointments")
      .select("id, status, starts_at, case_id, lead_id")
      .eq("staff_id", actor.userId)
      .gte("starts_at", fromIso)
      .lt("starts_at", toIso),
  ]);

  const leads         = leadsRes.data ?? [];
  const prevLeads     = prevLeadsRes.data ?? [];
  const contracts     = contractsRes.data ?? [];
  const prevContracts = prevContractsRes.data ?? [];
  const readyCases    = readyForDianaRes.data ?? [];
  const apptsCurr     = apptCurrRes.data ?? [];

  // Need case IDs of signed contracts to verify they belong to this actor's cases.
  // Filter: only count contracts whose case was assigned to this actor.
  const caseIdsForSigned = contracts.map((c) => c.case_id).filter(Boolean) as string[];
  let actorSignedCount = 0;
  let prevActorSignedCount = 0;

  if (caseIdsForSigned.length > 0) {
    const { data: actorCases } = await client
      .from("cases")
      .select("id")
      .eq("assigned_sales_id", actor.userId)
      .in("id", caseIdsForSigned);
    const actorCaseIdSet = new Set((actorCases ?? []).map((c) => c.id));
    actorSignedCount = contracts.filter((c) => c.case_id && actorCaseIdSet.has(c.case_id)).length;
  }

  if (prevContracts.length > 0) {
    const prevCaseIds = prevContracts.map((c) => c.case_id).filter(Boolean) as string[];
    if (prevCaseIds.length > 0) {
      const { data: prevActorCases } = await client
        .from("cases")
        .select("id")
        .eq("assigned_sales_id", actor.userId)
        .in("id", prevCaseIds);
      const prevActorCaseIdSet = new Set((prevActorCases ?? []).map((c) => c.id));
      prevActorSignedCount = prevContracts.filter((c) => c.case_id && prevActorCaseIdSet.has(c.case_id)).length;
    }
  }

  // ─── Funnel ───────────────────────────────────────────────────────────────

  const stage0 = leads.length;
  const stage1 = leads.filter((l) => l.contacted_at !== null).length;
  const stage2 = leads.filter((l) => l.won_case_id !== null || l.status === "won").length;
  const stage3 = apptsCurr.filter((a) => a.status === "completed").length;
  const stage4 = actorSignedCount;
  const stage5 = readyCases.length;

  // ─── Conversion ───────────────────────────────────────────────────────────

  const conversionPct = stage0 > 0 ? Math.round((stage4 / stage0) * 100) : null;

  // ─── Attendance ───────────────────────────────────────────────────────────

  const completedCount = apptsCurr.filter((a) => a.status === "completed").length;
  const noShowCount    = apptsCurr.filter((a) => a.status === "no_show").length;
  const attendanceDenom = completedCount + noShowCount;
  const attendancePct =
    attendanceDenom > 0 ? Math.round((completedCount / attendanceDenom) * 100) : null;

  // ─── Rescheduled ──────────────────────────────────────────────────────────

  const rescheduledCount = apptsCurr.filter((a) => a.status === "rescheduled").length;

  // ─── Week bars: per-day activity (lead creation + appointment activity) ───

  const spanDays = Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
  const DAY_ABBR_ES = ["D", "L", "M", "X", "J", "V", "S"]; // Sunday=0 in JS

  const barMap = new Map<string, number>();
  for (let i = 0; i < spanDays; i++) {
    const d = new Date(from.getTime() + i * 86_400_000);
    barMap.set(d.toISOString().slice(0, 10), 0);
  }

  for (const lead of leads) {
    const day = lead.created_at.slice(0, 10);
    if (barMap.has(day)) barMap.set(day, (barMap.get(day) ?? 0) + 1);
  }
  for (const appt of apptsCurr) {
    const day = appt.starts_at.slice(0, 10);
    if (barMap.has(day)) barMap.set(day, (barMap.get(day) ?? 0) + 1);
  }

  const weekBars: WeekActivityBar[] = Array.from(barMap.entries()).map(([dayIso, count]) => {
    const d = new Date(dayIso + "T12:00:00Z");
    const jsDay = d.getUTCDay(); // 0=Sun, 1=Mon, …
    return { dayLabel: DAY_ABBR_ES[jsDay], dayIso, count };
  });

  // ─── Source metrics ────────────────────────────────────────────────────────

  const sourceMap = new Map<string, { total: number; won: number }>();
  // Include ALL leads by this actor (not just period) for conversion accuracy
  // when period is short. For now, use only the period leads (consistent with §6.2).
  for (const lead of leads) {
    const src = lead.source ?? "unknown";
    const existing = sourceMap.get(src) ?? { total: 0, won: 0 };
    existing.total++;
    if (lead.status === "won" || lead.won_case_id !== null) existing.won++;
    sourceMap.set(src, existing);
  }
  const sources: SourceMetric[] = Array.from(sourceMap.entries())
    .map(([source, { total, won }]) => ({ source, total, won }))
    .sort((a, b) => b.total - a.total);

  // ─── Median contact velocity ───────────────────────────────────────────────

  const contactMinutes = leads
    .filter((l) => l.contacted_at !== null)
    .map((l) => {
      const created   = new Date(l.created_at).getTime();
      const contacted = new Date(l.contacted_at!).getTime();
      return Math.round((contacted - created) / 60_000);
    })
    .filter((m) => m >= 0);

  const medianContactMinutes = median(contactMinutes);

  // ─── Result ───────────────────────────────────────────────────────────────

  return {
    newLeadsCount: stage0,
    closuresCount: stage4,
    readyForDianaCount: stage5,
    conversionPct,
    prevClosuresCount: prevActorSignedCount,
    prevNewLeadsCount: prevLeads.length,
    funnel: { stage0, stage1, stage2, stage3, stage4, stage5 },
    weekBars,
    sources,
    attendancePct,
    rescheduledCount,
    medianContactMinutes,
  };
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

/**
 * Handles expediente.sent_to_finance → create card on Andrium's "Por imprimir" column.
 *
 * RF-AND-006 / DOC-45 §3.8 (consumer side).
 * Idempotent: if a card for this caseId already exists on the board, skip.
 * The DB unique (ref_type, ref_id, column_id) constraint also guards against duplicates.
 */
export async function onExpedienteSentToFinance(payload: {
  caseId: string;
  orgId: string;
}): Promise<void> {
  try {
    const { caseId, orgId } = payload;

    const financeStaff = await repo.findFinanceStaff(orgId);
    if (financeStaff.length === 0) {
      logger.warn({ orgId }, "kanban: onExpedienteSentToFinance — no finance staff found");
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

      // Idempotency: skip if card already exists on ANY column of this board
      const existing = await repo.findCardByRef(board.id, "case", caseId);
      if (existing) continue;

      // Find the "Por imprimir" column. Self-heal a column-less board (e.g. one
      // left empty by an earlier failed seed) before giving up.
      let columns = await repo.listColumns(board.id);
      if (columns.length === 0) {
        await repo.seedBoardColumns(board.id, seedColumnsFor("collections"));
        columns = await repo.listColumns(board.id);
      }
      const printCol = columns.find((c) => c.label === "Por imprimir");
      if (!printCol) {
        logger.warn({ boardId: board.id }, "kanban: onExpedienteSentToFinance — 'Por imprimir' column not found");
        continue;
      }

      const maxPos = await repo.maxCardPosition(printCol.id);
      const newCard = await repo.insertCard({
        column_id: printCol.id,
        ref_type: "case",
        ref_id: caseId,
        position: maxPos + 1,
      });

      logger.info({ caseId, staffId: staff.userId }, "kanban: expediente.sent_to_finance card created");

      await broadcastCardMoved(board.id, {
        card_id: newCard.id,
        from_column_id: printCol.id,
        to_column_id: printCol.id,
        position: maxPos + 1,
        actor_user_id: systemActor().userId,
      });
    }
  } catch (err) {
    logger.error({ err, payload }, "kanban: onExpedienteSentToFinance failed");
  }
}

// ---------------------------------------------------------------------------
// F6-Ola2: onInstallmentOverdue — create/move card to "Vencidas"
// ---------------------------------------------------------------------------

/**
 * Handles installment.overdue → create or move card to "Vencidas" on
 * Andrium's collections board.
 *
 * Idempotent: if card already exists on ANY column of the board, MOVE it to
 * "Vencidas" (if not already there). If it does not exist, create it.
 * DB unique (ref_type, ref_id, column_id) is the last line of defence.
 *
 * DOC-47 §3.8, RF-TRX-009.3.
 */
export async function onInstallmentOverdue(payload: {
  caseId: string;
  orgId: string;
  installmentId: string;
  number: number;
  amountCents: number;
  dueDate: string;
  daysLate: number;
}): Promise<void> {
  try {
    const { caseId, orgId } = payload;

    const financeStaff = await repo.findFinanceStaff(orgId);
    if (financeStaff.length === 0) {
      logger.warn({ orgId }, "kanban: onInstallmentOverdue — no finance staff found");
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

      // Self-heal column-less board
      let columns = await repo.listColumns(board.id);
      if (columns.length === 0) {
        await repo.seedBoardColumns(board.id, seedColumnsFor("collections"));
        columns = await repo.listColumns(board.id);
      }

      const vencidasCol = columns.find((c) => c.label === "Vencidas");
      if (!vencidasCol) {
        logger.warn({ boardId: board.id }, "kanban: onInstallmentOverdue — 'Vencidas' column not found");
        continue;
      }

      const existing = await repo.findCardByRef(board.id, "case", caseId);
      if (existing) {
        // Card already on this board — move to "Vencidas" if not already there
        if (existing.column_id !== vencidasCol.id) {
          const maxPos = await repo.maxCardPosition(vencidasCol.id);
          await repo.updateCard(existing.id, {
            column_id: vencidasCol.id,
            position: maxPos + 1,
          });
          logger.info({ caseId, staffId: staff.userId }, "kanban: onInstallmentOverdue card moved to Vencidas");

          // BLOCKER-2 fix: broadcast with real card id, correct from/to columns and position
          await broadcastCardMoved(board.id, {
            card_id: existing.id,            // real card row id (not caseId)
            from_column_id: existing.column_id, // where it was BEFORE the move
            to_column_id: vencidasCol.id,
            position: maxPos + 1,
            actor_user_id: systemActor().userId,
          });
        }
        // If already on Vencidas, no broadcast needed (no-op move)
      } else {
        // No card yet — create it in "Vencidas"
        const maxPos = await repo.maxCardPosition(vencidasCol.id);
        const newCard = await repo.insertCard({
          column_id: vencidasCol.id,
          ref_type: "case",
          ref_id: caseId,
          position: maxPos + 1,
        });
        logger.info({ caseId, staffId: staff.userId }, "kanban: onInstallmentOverdue card created in Vencidas");

        // BLOCKER-2 fix: broadcast with real card id from insertCard return value
        await broadcastCardMoved(board.id, {
          card_id: newCard.id,             // real card row id from insertCard
          from_column_id: vencidasCol.id,  // creation: from == to
          to_column_id: vencidasCol.id,
          position: maxPos + 1,
          actor_user_id: systemActor().userId,
        });
      }
    }
  } catch (err) {
    logger.error({ err, payload }, "kanban: onInstallmentOverdue failed");
  }
}

// ---------------------------------------------------------------------------
// F6-Ola2: onExpedientePrinted — move card to "Hecho" (RF-AND-025)
// ---------------------------------------------------------------------------

/**
 * Handles expediente.printed → move case card to "Hecho" on Andrium's board.
 *
 * If no card exists → no-op (RF-TRX-009 rule: "printed" is maintenance only,
 * NOT a creation event). Board/column self-healing still applies.
 *
 * DOC-47 §3.8, RF-AND-006 CA.
 */
export async function onExpedientePrinted(payload: {
  caseId: string;
  orgId: string;
  expedienteId: string;
  attemptNo: number;
  printedAt: string;
  printedById: string;
}): Promise<void> {
  try {
    const { caseId, orgId } = payload;

    const financeStaff = await repo.findFinanceStaff(orgId);
    if (financeStaff.length === 0) {
      logger.warn({ orgId }, "kanban: onExpedientePrinted — no finance staff found");
      return;
    }

    for (const staff of financeStaff) {
      const board = await repo.findBoard(staff.userId, "collections");
      if (!board) continue; // No board → no-op (board must pre-exist from sent_to_finance)

      // Self-heal column-less board
      let columns = await repo.listColumns(board.id);
      if (columns.length === 0) {
        await repo.seedBoardColumns(board.id, seedColumnsFor("collections"));
        columns = await repo.listColumns(board.id);
      }

      const hechoCol = columns.find((c) => c.label === "Hecho");
      if (!hechoCol) {
        logger.warn({ boardId: board.id }, "kanban: onExpedientePrinted — 'Hecho' column not found");
        continue;
      }

      const existing = await repo.findCardByRef(board.id, "case", caseId);
      if (!existing) {
        // RF-TRX-009 CA3: "printed" does NOT create cards
        logger.info({ caseId, staffId: staff.userId }, "kanban: onExpedientePrinted — no card to move (no-op)");
        continue;
      }

      if (existing.column_id === hechoCol.id) continue; // Already in "Hecho"

      const maxPos = await repo.maxCardPosition(hechoCol.id);
      await repo.updateCard(existing.id, {
        column_id: hechoCol.id,
        position: maxPos + 1,
      });

      await broadcastCardMoved(board.id, {
        card_id: existing.id,
        from_column_id: existing.column_id,
        to_column_id: hechoCol.id,
        position: maxPos + 1,
        actor_user_id: systemActor().userId,
      });

      logger.info({ caseId, staffId: staff.userId }, "kanban: onExpedientePrinted card moved to Hecho");
    }
  } catch (err) {
    logger.error({ err, payload }, "kanban: onExpedientePrinted failed");
  }
}

// ---------------------------------------------------------------------------
// GAP-2 — backfillCasesBoard (F5-Ola3 kanban board support)
// ---------------------------------------------------------------------------

/**
 * Ensures that each caseId in the list has a card on the actor's cases board.
 * Missing cards are inserted at the entry column ("Por iniciar").
 * Idempotent — safe to call on every page load; DB unique constraint on
 * (ref_type, ref_id, column_id) provides final-layer protection.
 *
 * Design note: caseIds are passed in by the page (from listCasesForParalegal),
 * keeping kanban agnostic of the cases schema (no cross-module query here).
 *
 * @GAP-2
 */
export async function backfillCasesBoard(
  actor: Actor,
  caseIds: string[],
): Promise<void> {
  can(actor, "cases", "view");

  if (caseIds.length === 0) return;

  // Find or create the actor's cases board
  let board = await repo.findBoard(actor.userId, "cases");
  if (!board) {
    board = await repo.createBoardWithSeed(
      actor.userId,
      actor.orgId,
      "cases",
      seedColumnsFor("cases"),
    );
  }

  // Find entry column ("Por iniciar" — lowest position). Self-heal a column-less
  // board so a partially-seeded board never breaks the backfill.
  let columns = await repo.listColumns(board.id);
  if (columns.length === 0) {
    await repo.seedBoardColumns(board.id, seedColumnsFor("cases"));
    columns = await repo.listColumns(board.id);
  }
  if (columns.length === 0) return;

  const entryCol = columns.reduce((min, c) =>
    c.position < min.position ? c : min,
  );

  // Insert missing cards; skip existing ones (idempotent). Positions are tracked
  // in-memory and incremented per insert so multiple new cards never collide on
  // the (column_id, position) unique constraint.
  let nextPos = (await repo.maxCardPosition(entryCol.id)) + 1;
  for (const caseId of caseIds) {
    const existing = await repo.findCardByRef(board.id, "case", caseId);
    if (existing) continue;

    await repo.insertCard({
      column_id: entryCol.id,
      ref_type: "case",
      ref_id: caseId,
      position: nextPos,
    });
    nextPos += 1;

    logger.info({ caseId, paralegalId: actor.userId }, "kanban: backfillCasesBoard — card inserted");
  }
}
