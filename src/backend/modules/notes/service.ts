/**
 * Notes module — service layer (use cases).
 *
 * Authorization is ALWAYS the first line:
 *   - case notes gate on the 'cases' module (via requireCaseAccess — also the
 *     cross-org IDOR guard), lead notes on the 'leads' module + an org guard.
 *   - creating a note needs only VIEW (finance participates); editing/deleting
 *     is author-or-admin (domain canEditNote).
 * RLS (0083_notes.sql) is the authoritative gate; this layer mirrors it for
 * clean errors and writes an audit row per mutation.
 *
 * @module notes/service
 */

import { can, requireCaseAccess, AuthzError } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { createServiceClient } from "@/backend/platform/supabase";
import { writeAudit } from "@/backend/modules/audit";
import {
  canEditNote,
  isNoteVisibility,
  noteBodySchema,
  type NoteVisibility,
} from "./domain";
import * as repo from "./repository";
import type { NoteRow, NoteAnchorSummary } from "./repository";

// ---------------------------------------------------------------------------
// Error + DTO
// ---------------------------------------------------------------------------

export class NotesError extends Error {
  constructor(
    public readonly code:
      | "NOTE_NOT_FOUND"
      | "NOTE_BODY_INVALID"
      | "NOTE_VISIBILITY_INVALID"
      | "NOTE_FORBIDDEN"
      | "NOTE_SUBJECT_NOT_FOUND",
  ) {
    super(code);
    this.name = "NotesError";
  }
}

export interface NoteVM {
  id: string;
  body: string;
  visibility: NoteVisibility;
  authorUserId: string;
  authorName: string | null;
  authorAvatar: string | null;
  createdAt: string;
  updatedAt: string;
  /** true when the note is anchored to the originating lead (carried into the case). */
  fromLead: boolean;
  /** may the CURRENT actor edit/delete this note. */
  canEdit: boolean;
}

export type NotesSummary = NoteAnchorSummary;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateBody(body: string): string {
  const parsed = noteBodySchema.safeParse(body);
  if (!parsed.success) throw new NotesError("NOTE_BODY_INVALID");
  return parsed.data;
}

function validateVisibility(visibility: string): NoteVisibility {
  if (!isNoteVisibility(visibility)) throw new NotesError("NOTE_VISIBILITY_INVALID");
  return visibility;
}

async function assertLeadInOrg(actor: Actor, leadId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("leads").select("org_id").eq("id", leadId).maybeSingle();
  if (!data) throw new NotesError("NOTE_SUBJECT_NOT_FOUND");
  if (data.org_id !== actor.orgId) throw new AuthzError("cross_org_access_denied");
}

async function toVMs(actor: Actor, rows: NoteRow[]): Promise<NoteVM[]> {
  const authors = await repo.fetchAuthors(rows.map((r) => r.author_user_id));
  return rows.map((r) => {
    const a = authors.get(r.author_user_id);
    return {
      id: r.id,
      body: r.body,
      visibility: r.visibility as NoteVisibility,
      authorUserId: r.author_user_id,
      authorName: a?.name ?? null,
      authorAvatar: a?.avatar ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      fromLead: r.lead_id !== null,
      canEdit: canEditNote(actor, { authorUserId: r.author_user_id }),
    };
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function addCaseNote(
  actor: Actor,
  input: { caseId: string; body: string; visibility: string },
): Promise<NoteVM> {
  await requireCaseAccess(actor, input.caseId); // can('cases','view') + cross-org guard
  const body = validateBody(input.body);
  const visibility = validateVisibility(input.visibility);

  const row = await repo.insertNote({
    org_id: actor.orgId,
    case_id: input.caseId,
    lead_id: null,
    author_user_id: actor.userId,
    visibility,
    body,
  });
  await writeAudit(actor, "notes.created", "notes", row.id, {
    after: { case_id: input.caseId, visibility },
  });
  return (await toVMs(actor, [row]))[0];
}

export async function addLeadNote(
  actor: Actor,
  input: { leadId: string; body: string; visibility: string },
): Promise<NoteVM> {
  can(actor, "leads", "view");
  await assertLeadInOrg(actor, input.leadId);
  const body = validateBody(input.body);
  const visibility = validateVisibility(input.visibility);

  const row = await repo.insertNote({
    org_id: actor.orgId,
    case_id: null,
    lead_id: input.leadId,
    author_user_id: actor.userId,
    visibility,
    body,
  });
  await writeAudit(actor, "notes.created", "notes", row.id, {
    after: { lead_id: input.leadId, visibility },
  });
  return (await toVMs(actor, [row]))[0];
}

export async function editNote(
  actor: Actor,
  input: { noteId: string; body?: string; visibility?: string },
): Promise<NoteVM> {
  const meta = await repo.findNoteMeta(input.noteId);
  if (!meta) throw new NotesError("NOTE_NOT_FOUND");
  if (meta.orgId !== actor.orgId) throw new AuthzError("cross_org_access_denied");
  if (!canEditNote(actor, { authorUserId: meta.authorUserId })) {
    throw new NotesError("NOTE_FORBIDDEN");
  }

  const patch: { body?: string; visibility?: string } = {};
  if (input.body !== undefined) patch.body = validateBody(input.body);
  if (input.visibility !== undefined) patch.visibility = validateVisibility(input.visibility);

  const row = await repo.updateNote(input.noteId, patch);
  if (!row) throw new NotesError("NOTE_NOT_FOUND");
  await writeAudit(actor, "notes.updated", "notes", row.id, { after: patch });
  return (await toVMs(actor, [row]))[0];
}

export async function removeNote(actor: Actor, input: { noteId: string }): Promise<void> {
  const meta = await repo.findNoteMeta(input.noteId);
  if (!meta) throw new NotesError("NOTE_NOT_FOUND");
  if (meta.orgId !== actor.orgId) throw new AuthzError("cross_org_access_denied");
  if (!canEditNote(actor, { authorUserId: meta.authorUserId })) {
    throw new NotesError("NOTE_FORBIDDEN");
  }
  await repo.deleteNote(input.noteId);
  await writeAudit(actor, "notes.deleted", "notes", input.noteId, {
    before: { case_id: meta.caseId, lead_id: meta.leadId },
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Case "Notas" tab — case notes + originating-lead notes, RLS-filtered per actor. */
export async function getCaseNotes(actor: Actor, caseId: string): Promise<NoteVM[]> {
  await requireCaseAccess(actor, caseId);
  const rows = await repo.listForCase(caseId);
  return toVMs(actor, rows);
}

export async function getLeadNotes(actor: Actor, leadId: string): Promise<NoteVM[]> {
  can(actor, "leads", "view");
  await assertLeadInOrg(actor, leadId);
  const rows = await repo.listForLead(leadId);
  return toVMs(actor, rows);
}

/** Client historial — general notes of a case the client belongs to. */
export async function getClientCaseNotes(actor: Actor, caseId: string): Promise<NoteVM[]> {
  await requireCaseAccess(actor, caseId); // client → case_members; staff → cases + org
  const rows = await repo.listGeneralForCase(caseId);
  return toVMs(actor, rows);
}

/** Board summaries (count + latest) keyed by case id. */
export async function getNotesSummaryForCases(
  actor: Actor,
  caseIds: string[],
): Promise<Map<string, NotesSummary>> {
  can(actor, "cases", "view");
  return repo.summariesForCases(caseIds);
}

/** Board summaries (count + latest) keyed by lead id. */
export async function getNotesSummaryForLeads(
  actor: Actor,
  leadIds: string[],
): Promise<Map<string, NotesSummary>> {
  can(actor, "leads", "view");
  return repo.summariesForLeads(leadIds);
}
