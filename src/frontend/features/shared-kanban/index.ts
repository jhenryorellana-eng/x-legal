/**
 * shared-kanban — reusable kanban column management (DOC-47 §2.3).
 *
 * The public surface every board (leads / cases / collections) consumes so
 * create / rename / recolor / reorder / delete-with-migration is implemented
 * once. Boundary: frontend → frontend | shared only.
 */

export type { KanbanColumnVM, KanbanColumnActions, KanbanColumnStrings } from "./types";
export { COLOR_TOKEN, tokenToVar, COLOR_SWATCHES } from "./column-color";
export { ColumnMenu } from "./column-menu";
export type { ColumnMenuProps } from "./column-menu";
export { ColumnModals } from "./column-modals";
export type { ColumnModalsProps } from "./column-modals";
export { useKanbanColumns } from "./use-kanban-columns";
export type {
  ColModalMode,
  UseKanbanColumnsOptions,
  UseKanbanColumnsResult,
} from "./use-kanban-columns";
