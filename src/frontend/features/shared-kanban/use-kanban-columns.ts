"use client";

/**
 * useKanbanColumns — shared column-management state machine (DOC-47 §2.3).
 *
 * Owns the column list + optimistic create / rename / recolor / reorder /
 * delete-with-migration, plus the modal + column-drag state. Board-agnostic:
 * the consuming board supplies `countCardsIn` (its own card state) and receives
 * `onColumnDeleted` so it can migrate its own cards optimistically. Extracted
 * from the original Diana board so leads / cases / collections share ONE
 * implementation.
 */

import * as React from "react";
import type { KanbanColumnVM, KanbanColumnActions, KanbanColumnStrings } from "./types";

export type ColModalMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; columnId: string; label: string; color: string }
  | { kind: "delete"; columnId: string; label: string; cardCount: number };

export interface UseKanbanColumnsOptions {
  boardId: string;
  initialColumns: KanbanColumnVM[];
  actions: KanbanColumnActions;
  strings: KanbanColumnStrings;
  toast: { error: (msg: string) => void };
  /** How many cards currently sit in a column (the board owns card state). */
  countCardsIn: (columnId: string) => number;
  /** Lets the board migrate its own cards optimistically when a column with
   *  cards is deleted (fromColumnId → migrateToColumnId). */
  onColumnDeleted?: (columnId: string, migrateToColumnId?: string) => void;
}

export interface UseKanbanColumnsResult {
  /** Columns sorted by position — render these. */
  columns: KanbanColumnVM[];
  colModal: ColModalMode;
  // create / edit form
  colLabel: string;
  setColLabel: (v: string) => void;
  colColor: string;
  setColColor: (v: string) => void;
  colLabelError: string;
  colBusy: boolean;
  // delete migration target
  migrateTarget: string;
  setMigrateTarget: (v: string) => void;
  // column drag-to-reorder
  colDragId: string | null;
  setColDragId: (v: string | null) => void;
  colOverId: string | null;
  setColOverId: (v: string | null) => void;
  // handlers
  openCreate: () => void;
  openEdit: (col: KanbanColumnVM) => void;
  openDelete: (col: KanbanColumnVM) => void;
  closeModal: () => void;
  handleColSave: () => Promise<void>;
  handleColDelete: () => Promise<void>;
  moveColumn: (col: KanbanColumnVM, dir: "left" | "right") => Promise<void>;
  handleColReorder: (targetCol: KanbanColumnVM) => Promise<void>;
}

export function useKanbanColumns({
  boardId,
  initialColumns,
  actions,
  strings,
  toast,
  countCardsIn,
  onColumnDeleted,
}: UseKanbanColumnsOptions): UseKanbanColumnsResult {
  const [columns, setColumns] = React.useState<KanbanColumnVM[]>(initialColumns);
  // Re-sync when the server re-renders (router.refresh after a create / handoff)
  // so columns appear/disappear without a manual reload.
  React.useEffect(() => { setColumns(initialColumns); }, [initialColumns]);

  const [colModal, setColModal] = React.useState<ColModalMode>({ kind: "closed" });
  const [colLabel, setColLabel] = React.useState("");
  const [colColor, setColColor] = React.useState("accent");
  const [colLabelError, setColLabelError] = React.useState("");
  const [colBusy, setColBusy] = React.useState(false);
  const [migrateTarget, setMigrateTarget] = React.useState("");

  const [colDragId, setColDragId] = React.useState<string | null>(null);
  const [colOverId, setColOverId] = React.useState<string | null>(null);

  const sorted = React.useMemo(
    () => [...columns].sort((a, b) => a.position - b.position),
    [columns],
  );

  // ── Modal open helpers ────────────────────────────────────────────────────
  const openCreate = React.useCallback(() => {
    setColLabel("");
    setColColor("accent");
    setColLabelError("");
    setColModal({ kind: "create" });
  }, []);

  const openEdit = React.useCallback((col: KanbanColumnVM) => {
    setColLabel(col.title);
    setColColor(col.color);
    setColLabelError("");
    setColModal({ kind: "edit", columnId: col.id, label: col.title, color: col.color });
  }, []);

  const openDelete = React.useCallback(
    (col: KanbanColumnVM) => {
      const otherCols = sorted.filter((c) => c.id !== col.id);
      setMigrateTarget(otherCols[0]?.id ?? "");
      setColModal({ kind: "delete", columnId: col.id, label: col.title, cardCount: countCardsIn(col.id) });
    },
    [sorted, countCardsIn],
  );

  const closeModal = React.useCallback(() => setColModal({ kind: "closed" }), []);

  // ── Create / edit save ────────────────────────────────────────────────────
  const handleColSave = React.useCallback(async () => {
    if (!colLabel.trim()) {
      setColLabelError(strings.colNameRequired);
      return;
    }
    setColLabelError("");
    setColBusy(true);

    if (colModal.kind === "create") {
      const res = await actions.createColumn({ boardId, label: colLabel.trim(), color: colColor });
      if (!res.ok) {
        toast.error(strings.createError);
      } else {
        const maxPos = columns.reduce((m, c) => Math.max(m, c.position), 0);
        const newCol: KanbanColumnVM = {
          id: res.columnId ?? `tmp-${maxPos + 1}`,
          boardId,
          title: colLabel.trim(),
          color: colColor,
          isTerminalWon: false,
          isTerminalLost: false,
          position: maxPos + 1,
        };
        setColumns((cols) => [...cols, newCol]);
      }
    } else if (colModal.kind === "edit") {
      const { columnId } = colModal;
      const res = await actions.updateColumn({ columnId, label: colLabel.trim(), color: colColor });
      if (!res.ok) {
        toast.error(strings.editError);
      } else {
        setColumns((cols) =>
          cols.map((c) => (c.id === columnId ? { ...c, title: colLabel.trim(), color: colColor } : c)),
        );
      }
    }

    setColBusy(false);
    setColModal({ kind: "closed" });
  }, [actions, boardId, colColor, colLabel, colModal, columns, strings, toast]);

  // ── Delete (with optional card migration) ─────────────────────────────────
  const handleColDelete = React.useCallback(async () => {
    if (colModal.kind !== "delete") return;
    const { columnId, cardCount } = colModal;

    if (columns.length <= 1) {
      toast.error(strings.delLastColumn);
      return;
    }

    setColBusy(true);
    const res = await actions.deleteColumn({
      columnId,
      migrateToColumnId: cardCount > 0 ? migrateTarget : undefined,
    });

    if (!res.ok) {
      toast.error(strings.deleteError);
    } else {
      if (cardCount > 0 && migrateTarget) onColumnDeleted?.(columnId, migrateTarget);
      setColumns((cols) => cols.filter((c) => c.id !== columnId));
    }
    setColBusy(false);
    setColModal({ kind: "closed" });
  }, [actions, colModal, columns.length, migrateTarget, onColumnDeleted, strings, toast]);

  // ── Reorder: swap with neighbour (keyboard/pointer-accessible) ─────────────
  const persistOrder = React.useCallback(
    async (repositioned: KanbanColumnVM[], prev: KanbanColumnVM[]) => {
      setColumns(repositioned);
      const res = await actions.reorderColumns({
        boardId,
        orderedColumnIds: repositioned.map((c) => c.id),
      });
      if (!res.ok) {
        setColumns(prev);
        toast.error(strings.orderError);
      }
    },
    [actions, boardId, strings, toast],
  );

  const moveColumn = React.useCallback(
    async (col: KanbanColumnVM, dir: "left" | "right") => {
      const ordered = [...columns].sort((a, b) => a.position - b.position);
      const idx = ordered.findIndex((c) => c.id === col.id);
      const swapIdx = dir === "left" ? idx - 1 : idx + 1;
      if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) return;

      const prev = columns;
      const next = [...ordered];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      const repositioned = next.map((c, i) => ({ ...c, position: i + 1 }));
      await persistOrder(repositioned, prev);
    },
    [columns, persistOrder],
  );

  // ── Reorder: drag a column onto another ───────────────────────────────────
  const handleColReorder = React.useCallback(
    async (targetCol: KanbanColumnVM) => {
      const srcId = colDragId;
      setColDragId(null);
      setColOverId(null);
      if (!srcId || srcId === targetCol.id) return;

      const ordered = [...columns].sort((a, b) => a.position - b.position);
      const srcIdx = ordered.findIndex((c) => c.id === srcId);
      const tgtIdx = ordered.findIndex((c) => c.id === targetCol.id);
      if (srcIdx < 0 || tgtIdx < 0) return;

      const prev = columns;
      const next = [...ordered];
      const [moved] = next.splice(srcIdx, 1);
      next.splice(tgtIdx, 0, moved);
      const repositioned = next.map((c, i) => ({ ...c, position: i + 1 }));
      await persistOrder(repositioned, prev);
    },
    [colDragId, columns, persistOrder],
  );

  return {
    columns: sorted,
    colModal,
    colLabel,
    setColLabel: (v) => { setColLabel(v); setColLabelError(""); },
    colColor,
    setColColor,
    colLabelError,
    colBusy,
    migrateTarget,
    setMigrateTarget,
    colDragId,
    setColDragId,
    colOverId,
    setColOverId,
    openCreate,
    openEdit,
    openDelete,
    closeModal,
    handleColSave,
    handleColDelete,
    moveColumn,
    handleColReorder,
  };
}
