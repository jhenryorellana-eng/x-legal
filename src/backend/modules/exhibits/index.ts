/**
 * exhibits module — public API (module-pub boundary).
 *
 * Other modules + the jobs/ layer import from here only (Rule R3).
 *
 * Owns the pipeline that turns the sources cited in an AI letter's "Index of
 * Exhibits" into physical PDF annexes bound into the expediente.
 *
 * @module exhibits
 */

export {
  // generation.completed consumer entry
  captureFromRun,
  // QStash job entry (consumed by jobs/fetch-exhibit.ts)
  executeFetchExhibitJob,
  // Diana panel (read + retry + manual upload)
  getExhibitsForCase,
  retryExhibit,
  createExhibitUploadUrl,
  confirmManualExhibit,
  // reads (assembler material / panel)
  listReadyByCase,
  listByRun,
  // Index of Exhibits divider (consumed by expediente compile)
  renderExhibitIndexForExhibits,
  ExhibitsError,
} from "./service";

export type { CaptureResult, ExhibitJobOutcome } from "./service";

export type { ExhibitsRunSettledPayload } from "./events";
export { emitExhibitsRunSettled } from "./events";

export type { CaseExhibitRow } from "./repository";
