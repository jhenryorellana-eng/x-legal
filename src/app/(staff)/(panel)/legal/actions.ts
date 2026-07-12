"use server";

/**
 * Legal (Diana) server actions (DOC-54 §1, DOC-47 §3, DOC-48 API-KAN-*).
 *
 * Thin "use server" wrappers over the kanban module's use cases.
 * Every action: requireActor → delegate to service → return envelope.
 * Boundary R1/R2: app → module-pub only (never repository/platform directly).
 *
 * API map:
 *   moveKanbanCardAction        → API-KAN-02
 *   updateKanbanCardNoteAction  → API-KAN-07
 *   createKanbanColumnAction    → API-KAN-03
 *   updateKanbanColumnAction    → API-KAN-04
 *   reorderKanbanColumnsAction  → API-KAN-05
 *   deleteKanbanColumnAction    → API-KAN-06
 */

import { requireActor, AuthzError } from "@/backend/modules/identity";
import {
  moveCard,
  createColumn,
  updateColumn,
  reorderColumns,
  deleteColumn,
  KanbanError,
} from "@/backend/modules/kanban";

type Ok<T = object> = { ok: true } & T;
type Err = { ok: false; error: { code: string } };

function mapErr(err: unknown): Err {
  if (err instanceof AuthzError) return { ok: false, error: { code: err.reason } };
  if (err instanceof KanbanError) return { ok: false, error: { code: err.code } };
  console.error("[legal action] unexpected:", (err as Error)?.message ?? String(err));
  return { ok: false, error: { code: "internal" } };
}

// ---------------------------------------------------------------------------
// API-KAN-02 — move card (drag & drop)
// ---------------------------------------------------------------------------

export async function moveKanbanCardAction(input: {
  cardId: string;
  toColumnId: string;
  toPosition: number;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await moveCard(actor, {
      cardId: input.cardId,
      toColumnId: input.toColumnId,
      toPosition: input.toPosition,
    });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// API-KAN-03 — create a new column
// ---------------------------------------------------------------------------

export async function createKanbanColumnAction(input: {
  boardId: string;
  label: string;
  color: string;
}): Promise<Ok<{ columnId: string }> | Err> {
  try {
    const actor = await requireActor();
    const col = await createColumn(actor, {
      boardId: input.boardId,
      label: input.label,
      color: input.color as Parameters<typeof createColumn>[1]["color"],
    });
    return { ok: true, columnId: col.id };
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// API-KAN-04 — update a column (label, color)
// ---------------------------------------------------------------------------

export async function updateKanbanColumnAction(input: {
  columnId: string;
  label?: string;
  color?: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await updateColumn(actor, {
      columnId: input.columnId,
      label: input.label,
      color: input.color as Parameters<typeof updateColumn>[1]["color"],
    });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// API-KAN-05 — reorder columns
// ---------------------------------------------------------------------------

export async function reorderKanbanColumnsAction(input: {
  boardId: string;
  orderedColumnIds: string[];
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await reorderColumns(actor, {
      boardId: input.boardId,
      orderedColumnIds: input.orderedColumnIds,
    });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

// ---------------------------------------------------------------------------
// API-KAN-06 — delete a column (with optional card migration)
// ---------------------------------------------------------------------------

export async function deleteKanbanColumnAction(input: {
  columnId: string;
  migrateToColumnId?: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await deleteColumn(actor, {
      columnId: input.columnId,
      migrateToColumnId: input.migrateToColumnId,
    });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}
