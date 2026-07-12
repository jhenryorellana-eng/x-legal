/**
 * Notes module — public API (module-pub boundary).
 *
 * Other modules / the app MUST import from here, never from service.ts /
 * repository.ts directly (Rule R3).
 */

// Use cases
export {
  addCaseNote,
  addLeadNote,
  editNote,
  removeNote,
  getCaseNotes,
  getLeadNotes,
  getClientCaseNotes,
  getNotesSummaryForCases,
  getNotesSummaryForLeads,
  NotesError,
} from "./service";

// DTO types
export type { NoteVM, NotesSummary } from "./service";

// Domain
export {
  NOTE_VISIBILITIES,
  isNoteVisibility,
  canEditNote,
  noteBodySchema,
  noteVisibilitySchema,
} from "./domain";
export type { NoteVisibility } from "./domain";

// Event types
export type { NoteCreatedEvent, NoteEvent } from "./events";
