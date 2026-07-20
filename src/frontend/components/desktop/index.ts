/** Desktop component catalog — staff panels (DOC-01 §5.3). */
export { Sidebar } from "./sidebar";
export type {
  SidebarProps,
  SidebarGroup,
  SidebarItem,
  SidebarUser,
} from "./sidebar";
export { Topbar, type TopbarProps, type TopbarMessages } from "./topbar";
export { Kpi, type KpiProps } from "./kpi";
export {
  DataTable,
  type DataTableProps,
  type Column,
  type SortDir,
} from "./data-table";
export { EmptyState, type EmptyStateProps, type EmptyStateAction } from "./empty-state";
export { Modal, type ModalProps } from "./modal";
export {
  KanbanMoveMenu,
  type KanbanMoveMenuProps,
  type KanbanMoveMenuColumn,
} from "./kanban-move-menu";
export { SidePanel, type SidePanelProps } from "./side-panel";
export { Switch, type DesktopSwitchProps } from "./switch";
export { Skeleton, type SkeletonProps } from "./skeleton";
export { BrandToaster, toast } from "./toast";
