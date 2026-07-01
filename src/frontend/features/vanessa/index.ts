/**
 * Vanessa sales panel features — public surface (DOC-52, DOC-50 §4).
 *
 * The RSC pages assemble the view models + inject server actions; the views are
 * presentational + data-driven. Shared Lex + UI helpers re-exported here.
 */

export { MiDiaView } from "./mi-dia/mi-dia-view";
export type {
  MiDiaViewProps,
  MiDiaKpi,
  AttendLead,
  AgendaItem,
  MiDiaTask,
  MiDiaStrings,
  MiDiaActions,
} from "./mi-dia/mi-dia-view";

export { LeadsView } from "./leads/leads-view";
export type {
  LeadsViewProps,
  LeadCardVM,
  LeadColumnVM,
  LeadsStrings,
  LeadsActions,
} from "./leads/leads-view";
export { NuevoLeadModal } from "./leads/nuevo-lead-modal";
export type {
  NuevoLeadModalProps,
  NuevoLeadStrings,
  NuevoLeadActions,
  EditLeadPreset,
  CategoryOption,
  ServiceOption,
  SourceOption,
} from "./leads/nuevo-lead-modal";
export { CategoryManager } from "./leads/category-manager";
export type {
  CategoryManagerProps,
  CategoryManagerStrings,
  CategoryManagerActions,
  CategoryItem,
} from "./leads/category-manager";

export { CitasView } from "./citas/citas-view";
export type { CitasViewProps, CitasStrings, CalDay } from "./citas/citas-view";
export { NuevaCitaModal } from "./citas/nueva-cita-modal";
export type {
  CitaEvent,
  CitaDetail,
  NuevaCitaModalProps,
  NuevaCitaStrings,
  NuevaCitaActions,
  ApptKind,
  ClientSearchResult,
  ProspectSearchResult,
} from "./citas/types";

export { DisponibilidadView } from "./disponibilidad/disponibilidad-view";
export type {
  DisponibilidadViewProps,
  DayRule,
  ExceptionVM,
  DisponibilidadStrings,
  DisponibilidadActions,
} from "./disponibilidad/disponibilidad-view";

export { MetricasView } from "./metricas/metricas-view";
export type {
  MetricasViewProps,
  MetricKpi,
  FunnelStage,
  WeekBar,
  DonutVM,
  SourceRow,
  SecondaryCard,
  MetricasStrings,
} from "./metricas/metricas-view";

export { ClientesListView } from "./clientes/clientes-list-view";
export type {
  ClientesListViewProps,
  CaseRowVM,
  ClientesStrings,
} from "./clientes/clientes-list-view";

export { ConfiguracionView } from "./configuracion/configuracion-view";
export type {
  ConfiguracionViewProps,
  ConfigStrings,
  ConfigActions,
} from "./configuracion/configuracion-view";

export { LexDock, LexBubble } from "./shared/lex";
export type { LexQuickQuestion } from "./shared/lex";
export { LexPrefsProvider, useLexPrefs } from "./shared/lex-prefs";
export { MSym, MaterialSymbolsFont } from "./shared/msym";
