/**
 * Expediente module — public API (module-pub boundary).
 *
 * Other modules MUST import from here, never from service.ts / repository.ts directly.
 * Rule R3: no cross-module imports except via index.ts.
 *
 * @module expediente
 */

// ---------------------------------------------------------------------------
// Use cases (service layer)
// ---------------------------------------------------------------------------

// Covers
export {
  listCoverTemplates,
  generateCover,
} from "./service";

// Ensamblador reads
export {
  getCaseExpedientes,
  getExpediente,
  getExpedienteMaterial,
} from "./service";

// Ensamblador mutations
export {
  createExpediente,
  addItem,
  removeItem,
  reorderItems,
  updateItem,
  createExternalFileUploadUrl,
  confirmExternalFile,
} from "./service";

// Compilation
export {
  compileExpediente,
  getCompiledPdfUrl,
} from "./service";

// Corrections
export {
  createCorrectionAttempt,
} from "./service";

// Print queue (Andrium — RF-AND-023)
export {
  listPrintQueue,
} from "./service";

export type {
  PrintQueueItemDto,
} from "./service";

// Handoff to Andrium (printing)
export {
  sendToFinance,
  markPrinted,
  markShipped,
  markFiled,
} from "./service";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type {
  GenerateCoverInput,
  CreateExpedienteInput,
  ExpedienteWithItems,
  ExpedienteMaterial,
  AddItemInput,
  ReorderItemsInput,
  UpdateItemInput,
  CreateExternalFileUploadUrlInput,
  ConfirmExternalFileInput,
} from "./service";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export { ExpedienteError } from "./service";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type {
  ExpedienteStatus,
  ExpedienteItemType,
  StaffRole,
  ExpedienteTransitionRule,
} from "./domain";

export {
  EXPEDIENTE_STATUSES,
  EXPEDIENTE_ITEM_TYPES,
  EXPEDIENTE_TRANSITIONS,
  canTransitionExpediente,
  isEditableStatus,
  validateItemRef,
  canonicalClientLabel,
} from "./domain";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type {
  ExpedienteEvent,
  ExpedienteCompiledPayload,
  ExpedienteSentToFinancePayload,
  ExpedientePrintedPayload,
} from "./events";

export {
  emitExpedienteCompiled,
  emitExpedienteSentToFinance,
  emitExpedientePrinted,
  registerExpedienteConsumers,
} from "./events";

// ---------------------------------------------------------------------------
// Repository row types (for cross-module reads)
// ---------------------------------------------------------------------------

export type {
  ExpedienteRow,
  ExpedienteItemRow,
  CoverTemplateRow,
  CoverRenderRow,
} from "./repository";
