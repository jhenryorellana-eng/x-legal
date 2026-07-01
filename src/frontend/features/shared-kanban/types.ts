/**
 * Shared kanban column-management contracts (DOC-47 §2.3, API-KAN-03..06).
 *
 * These view-model / action / string types are the public surface every board
 * (leads / cases / collections) shares so column CRUD is implemented ONCE. The
 * RSC page builds the VM + injects the server-action wrappers; the client view
 * consumes them via `useKanbanColumns`.
 *
 * Boundary: pure types — no backend imports.
 */

/** One board column. Superset covering every board_kind (leads use both
 *  terminal flags; cases/collections only won). */
export interface KanbanColumnVM {
  id: string;
  boardId: string;
  title: string;
  /** Design-system color token (see column-color.ts) or a raw CSS color. */
  color: string;
  isTerminalWon: boolean;
  isTerminalLost: boolean;
  position: number;
}

/** The four "use server" wrappers over the kanban module use cases. The editor
 *  intentionally does NOT expose the terminal flags (they stay as seeded). */
export interface KanbanColumnActions {
  createColumn: (input: {
    boardId: string;
    label: string;
    color: string;
  }) => Promise<{ ok: boolean; columnId?: string; error?: { code: string } }>;

  updateColumn: (input: {
    columnId: string;
    label?: string;
    color?: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;

  reorderColumns: (input: {
    boardId: string;
    orderedColumnIds: string[];
  }) => Promise<{ ok: boolean; error?: { code: string } }>;

  deleteColumn: (input: {
    columnId: string;
    migrateToColumnId?: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
}

/** i18n bag for the column menu + create/edit + delete modals. */
export interface KanbanColumnStrings {
  newColumn: string;
  // error toasts
  orderError: string;
  createError: string;
  editError: string;
  deleteError: string;
  // create / edit modal
  colModalCreateTitle: string;
  colModalEditTitle: string;
  colNameLabel: string;
  colNamePh: string;
  colNameRequired: string;
  colColorLabel: string;
  colSave: string;
  colCancel: string;
  // delete modal
  delModalTitle: string;
  delModalBodyEmpty: string;
  delModalBodyCards: string; // "{n}"
  delMigrateLabel: string;
  delConfirm: string;
  delCancel: string;
  delLastColumn: string;
  // column ⋯ menu
  colMenuEdit: string;
  colMenuDelete: string;
  colMenuMoveLeft: string;
  colMenuMoveRight: string;
  colMenuAria: string; // "{title}"
}
