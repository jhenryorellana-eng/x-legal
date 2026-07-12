/**
 * Notes module — domain event payload types.
 *
 * Defined for a future consumer (e.g. notify the client when a `general` note is
 * added to their case). Not emitted yet — no consumer is registered.
 */

import type { NoteVisibility } from "./domain";

export interface NoteCreatedEvent {
  noteId: string;
  orgId: string;
  caseId: string | null;
  leadId: string | null;
  visibility: NoteVisibility;
  authorUserId: string;
}

export type NoteEvent = NoteCreatedEvent;
