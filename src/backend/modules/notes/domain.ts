/**
 * Notes module — pure domain (NO I/O). All functions are deterministic and
 * testable without mocks.
 *
 * A note has one of three visibility levels:
 *   general  → client (in their case history) + all staff
 *   team     → all staff of the org
 *   personal → only the author
 *
 * Anchoring (case XOR lead) and RLS visibility live in the DB (0083_notes.sql);
 * this file holds the shared type + validation + the edit/delete predicate.
 */

import { z } from "zod";

export const NOTE_VISIBILITIES = ["general", "team", "personal"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export function isNoteVisibility(value: string): value is NoteVisibility {
  return (NOTE_VISIBILITIES as readonly string[]).includes(value);
}

/** Body: trimmed, 1..4000 chars — mirrors the CHECK constraint. */
export const noteBodySchema = z.string().trim().min(1).max(4000);
export const noteVisibilitySchema = z.enum(NOTE_VISIBILITIES);

/**
 * A note may be edited/deleted by its author or by an org admin.
 * (RLS enforces the same rule; this is the app-layer mirror for clean errors.)
 */
export function canEditNote(
  actor: { userId: string; role: "admin" | "sales" | "paralegal" | "finance" | null },
  note: { authorUserId: string },
): boolean {
  return actor.role === "admin" || note.authorUserId === actor.userId;
}
