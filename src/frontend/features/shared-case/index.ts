/**
 * shared-case feature — public surface (DOC-50 §4).
 *
 * The single staff case workspace, montado por wrappers delgados de ruta.
 * F2-W2-b: first real consumer (admin/casos/[caseId]) with Resumen · Documentos
 * · Partes tabs; the rest of the canonical tabs arrive in future phases.
 */

export { SharedCaseView, type SharedCaseViewProps } from "./shared-case-view";
export { buildTabs, type TabConfig, type BuildTabsInput } from "./build-tabs";
export { buildCasosStrings, interp, resolveCasosActionError, type CasosStrings, type CasosLocale } from "./strings";
export type {
  CaseWorkspaceVM,
  CaseRutaVM,
  RutaCitaVM,
  RutaCitaObjectiveVM,
  CaseHeaderVM,
  CaseDetailActions,
  DocumentVM,
  PartyVM,
  CaseClientVM,
  CaseClientAddressVM,
  InstallmentVM,
  TimelineEventVM,
  DocMatrixVM,
  FormVM,
  GenerationVM,
  ValidationVM,
  ExpedienteVM,
  StaffRoleVM,
  CaseTabId,
  PreMortemVM,
  PreMortemReportVM,
  PreMortemTargetVM,
  PreMortemInFlightVM,
  PreMortemFindingVM,
  PreMortemSeverity,
  PreMortemSemaforo,
  PreMortemTargetKind,
  LexActions,
  LexMessageVM,
  LexThreadVM,
  LexSource,
} from "./types";
