"use server";

/**
 * Finanzas/Operaciones (Andrium) — kanban de casos server actions.
 *
 * Thin "use server" wrappers over the kanban module's use cases — identical to
 * the /legal actions (the kanban engine is generic; the owner is the actor).
 * Boundary R1/R2: app → module-pub only.
 */

import { requireActor, AuthzError } from "@/backend/modules/identity";
import {
  moveCard,
  updateCardNote,
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
  console.error("[finanzas/casos action] unexpected:", (err as Error)?.message ?? String(err));
  return { ok: false, error: { code: "internal" } };
}

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

export async function updateKanbanCardNoteAction(input: {
  cardId: string;
  note: string | null;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await updateCardNote(actor, { cardId: input.cardId, pinnedNote: input.note });
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

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
