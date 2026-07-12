/**
 * Notes module — repository (sole DB access point).
 *
 * Reads/writes go through the ACTOR-BOUND client (createServerClient) so RLS is
 * the authoritative visibility gate (defense in depth with can() in the service).
 * The SERVICE client is used only for two non-sensitive, same-org lookups:
 *   1. resolving a case's originating lead ids (leads RLS would hide them from
 *      roles without the 'leads' module, breaking the lead→case union), and
 *   2. author display names/avatars (staff_profiles).
 *
 * @module notes/repository
 */

import { createServerClient, createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import type { Tables, TablesInsert } from "@/shared/database.types";

export type NoteRow = Tables<"notes">;

export interface NoteAuthor {
  name: string | null;
  avatar: string | null;
}

export interface NoteAnchorSummary {
  /** notes visible to the current actor for this anchor */
  count: number;
  latestBody: string | null;
  latestAt: string | null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function insertNote(input: TablesInsert<"notes">): Promise<NoteRow> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("notes").insert(input).select("*").single();
  if (error || !data) {
    logger.error({ err: error?.message }, "notes: insertNote failed");
    throw error ?? new Error("notes.insert.no_row");
  }
  return data;
}

export async function updateNote(
  id: string,
  patch: { body?: string; visibility?: string },
): Promise<NoteRow | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("notes")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    logger.error({ err: error.message, id }, "notes: updateNote failed");
    throw error;
  }
  return data;
}

export async function deleteNote(id: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) {
    logger.error({ err: error.message, id }, "notes: deleteNote failed");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Service-client lookup of a note's org + author (for cross-org/authorship guards). */
export async function findNoteMeta(
  id: string,
): Promise<{ orgId: string; authorUserId: string; caseId: string | null; leadId: string | null } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("notes")
    .select("org_id, author_user_id, case_id, lead_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    orgId: data.org_id,
    authorUserId: data.author_user_id,
    caseId: data.case_id,
    leadId: data.lead_id,
  };
}

/** Originating lead ids for a case (service client — bypasses leads RLS). */
async function leadIdsForCase(caseId: string): Promise<string[]> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("leads").select("id").eq("won_case_id", caseId);
  return (data ?? []).map((r) => r.id);
}

/**
 * Notes shown in a case's "Notas" tab: notes anchored to the case UNION notes
 * anchored to the originating lead(s). RLS filters by the actor's visibility.
 */
export async function listForCase(caseId: string): Promise<NoteRow[]> {
  const supabase = await createServerClient();
  const leadIds = await leadIdsForCase(caseId);

  let query = supabase.from("notes").select("*");
  query =
    leadIds.length > 0
      ? query.or(`case_id.eq.${caseId},lead_id.in.(${leadIds.join(",")})`)
      : query.eq("case_id", caseId);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) {
    logger.error({ err: error.message, caseId }, "notes: listForCase failed");
    throw error;
  }
  return data ?? [];
}

export async function listForLead(leadId: string): Promise<NoteRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) {
    logger.error({ err: error.message, leadId }, "notes: listForLead failed");
    throw error;
  }
  return data ?? [];
}

/** Client-surface: general notes on a case (RLS notes_select_client double-guards). */
export async function listGeneralForCase(caseId: string): Promise<NoteRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("case_id", caseId)
    .eq("visibility", "general")
    .order("created_at", { ascending: false });
  if (error) {
    logger.error({ err: error.message, caseId }, "notes: listGeneralForCase failed");
    throw error;
  }
  return data ?? [];
}

/** Per-anchor summary (count + latest) for board cards, RLS-filtered per actor. */
async function summarize(
  column: "case_id" | "lead_id",
  ids: string[],
): Promise<Map<string, NoteAnchorSummary>> {
  const result = new Map<string, NoteAnchorSummary>();
  if (ids.length === 0) return result;

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("notes")
    .select("case_id, lead_id, body, created_at")
    .in(column, ids)
    .order("created_at", { ascending: false });
  if (error) {
    logger.error({ err: error.message, column }, "notes: summarize failed");
    throw error;
  }
  for (const row of data ?? []) {
    const key = (column === "case_id" ? row.case_id : row.lead_id) as string | null;
    if (!key) continue;
    const cur = result.get(key);
    if (!cur) {
      // First row per key is the latest (desc order).
      result.set(key, { count: 1, latestBody: row.body, latestAt: row.created_at });
    } else {
      cur.count += 1;
    }
  }
  return result;
}

export function summariesForCases(caseIds: string[]): Promise<Map<string, NoteAnchorSummary>> {
  return summarize("case_id", caseIds);
}

export function summariesForLeads(leadIds: string[]): Promise<Map<string, NoteAnchorSummary>> {
  return summarize("lead_id", leadIds);
}

/** Author display map (service client — authors are always same-org staff). */
export async function fetchAuthors(userIds: string[]): Promise<Map<string, NoteAuthor>> {
  const map = new Map<string, NoteAuthor>();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return map;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("staff_profiles")
    .select("user_id, display_name, avatar_url")
    .in("user_id", unique);
  for (const r of data ?? []) {
    map.set(r.user_id, { name: r.display_name, avatar: r.avatar_url });
  }
  return map;
}
