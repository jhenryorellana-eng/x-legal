/**
 * Messaging module — repository (service client; bypasses RLS).
 *
 * Reads/writes go through createServiceClient because the service layer
 * authorizes via requireParticipant/requireCaseAccess. markRead uses
 * service-role because conversation_participants.last_read_at has no column
 * GRANT for authenticated (R1).
 *
 * @module messaging/repository
 */

import { createServiceClient } from "@/backend/platform/supabase";
import type { Tables, Json } from "@/shared/database.types";
import type { ConversationScope, MessageKind } from "./domain";

export type ConversationRow = Tables<"conversations">;
export type ParticipantRow = Tables<"conversation_participants">;
export type MessageRow = Tables<"messages">;

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function findCaseConversation(caseId: string): Promise<ConversationRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("conversations")
    .select("*")
    .eq("case_id", caseId)
    .eq("scope", "case")
    .maybeSingle();
  return data ?? null;
}

export async function findConversationById(id: string): Promise<ConversationRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("conversations").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export interface InsertConversationInput {
  orgId: string;
  scope: ConversationScope;
  caseId?: string | null;
  leadId?: string | null;
  title?: string | null;
}

/** Inserts a conversation. Returns {row} on success, or {conflict:true} on the
 *  partial-unique (case_id where scope='case') violation so the caller can re-read. */
export async function insertConversation(
  input: InsertConversationInput,
): Promise<{ row: ConversationRow | null; conflict: boolean }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      org_id: input.orgId,
      scope: input.scope,
      case_id: input.caseId ?? null,
      lead_id: input.leadId ?? null,
      title: input.title ?? null,
    })
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") return { row: null, conflict: true };
    throw new Error(`messaging.repository: insertConversation — ${error.message}`);
  }
  return { row: data, conflict: false };
}

export async function touchLastMessageAt(conversationId: string, at: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("conversations")
    .update({ last_message_at: at })
    .eq("id", conversationId);
  if (error) throw new Error(`messaging.repository: touchLastMessageAt — ${error.message}`);
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

export async function listParticipantIds(conversationId: string): Promise<string[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", conversationId);
  return (data ?? []).map((r) => r.user_id);
}

export async function isParticipant(conversationId: string, userId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("conversation_participants")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

/** Participants with their user kind (for removeParticipant guards). */
export async function listParticipantsWithKind(
  conversationId: string,
): Promise<Array<{ userId: string; kind: string }>> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("conversation_participants")
    .select("user_id, users!inner(kind)")
    .eq("conversation_id", conversationId);
  const rows = (data ?? []) as unknown as Array<{
    user_id: string;
    users: { kind: string } | Array<{ kind: string }>;
  }>;
  return rows.map((r) => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    return { userId: r.user_id, kind: u?.kind ?? "client" };
  });
}

export async function getParticipant(
  conversationId: string,
  userId: string,
): Promise<ParticipantRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("conversation_participants")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

export async function addParticipants(conversationId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const supabase = createServiceClient();
  const rows = userIds.map((user_id) => ({ conversation_id: conversationId, user_id }));
  const { error } = await supabase
    .from("conversation_participants")
    .upsert(rows, { onConflict: "conversation_id,user_id", ignoreDuplicates: true });
  if (error) throw new Error(`messaging.repository: addParticipants — ${error.message}`);
}

export async function removeParticipant(conversationId: string, userId: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("conversation_participants")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (error) throw new Error(`messaging.repository: removeParticipant — ${error.message}`);
}

/** MONOTONIC: only advances last_read_at (conditional update where current < nowIso). */
export async function markReadMonotonic(
  conversationId: string,
  userId: string,
  nowIso: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("conversation_participants")
    .update({ last_read_at: nowIso })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .or(`last_read_at.is.null,last_read_at.lt.${nowIso}`);
  if (error) throw new Error(`messaging.repository: markReadMonotonic — ${error.message}`);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface InsertMessageInput {
  conversationId: string;
  senderUserId: string | null;
  kind: MessageKind;
  body?: string | null;
  bodyTranslated?: Json | null;
  attachments?: Json;
}

export async function insertMessage(input: InsertMessageInput): Promise<MessageRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      sender_user_id: input.senderUserId,
      kind: input.kind,
      body: input.body ?? null,
      body_translated: input.bodyTranslated ?? null,
      attachments: input.attachments ?? [],
    })
    .select()
    .single();
  if (error || !data) throw new Error(`messaging.repository: insertMessage — ${error?.message}`);
  return data;
}

export async function findMessageById(messageId: string): Promise<MessageRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("messages").select("*").eq("id", messageId).maybeSingle();
  return data ?? null;
}

/** Updates ONLY body_translated (immutability trigger permits this column). */
export async function setMessageTranslation(messageId: string, translated: Json): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("messages")
    .update({ body_translated: translated })
    .eq("id", messageId);
  if (error) throw new Error(`messaging.repository: setMessageTranslation — ${error.message}`);
}

export interface MessagesPage {
  items: MessageRow[];
  nextCursor: string | null;
}

/** Keyset pagination by created_at desc (clone of notifications). */
export async function listMessages(
  conversationId: string,
  opts: { cursor?: string; limit?: number },
): Promise<MessagesPage> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const supabase = createServiceClient();
  let query = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (opts.cursor) query = query.lt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) throw new Error(`messaging.repository: listMessages — ${error.message}`);

  const items = data ?? [];
  const hasMore = items.length > limit;
  if (hasMore) items.pop();
  return {
    items,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].created_at : null,
  };
}

// ---------------------------------------------------------------------------
// Unread aggregate badge (RF-TRX-017)
// ---------------------------------------------------------------------------

/**
 * Total unread across all the user's conversations. Per-conversation count with
 * its own last_read_at threshold (a user has few conversations in V2).
 */
export async function countUnreadAggregate(userId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data: parts } = await supabase
    .from("conversation_participants")
    .select("conversation_id, last_read_at")
    .eq("user_id", userId);

  const rows = (parts ?? []) as Array<{ conversation_id: string; last_read_at: string | null }>;
  if (rows.length === 0) return 0;

  const counts = await Promise.all(
    rows.map(async (p) => {
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", p.conversation_id)
        .neq("kind", "system")
        .neq("sender_user_id", userId)
        .gt("created_at", p.last_read_at ?? "1970-01-01T00:00:00.000Z");
      return count ?? 0;
    }),
  );
  return counts.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// Case participant sources + helpers
// ---------------------------------------------------------------------------

export async function loadCaseParticipantSources(caseId: string): Promise<{
  orgId: string | null;
  caseMemberIds: string[];
  paralegalId: string | null;
  salesId: string | null;
  adminIds: string[];
}> {
  const supabase = createServiceClient();

  // Fetch the case first so org admins can be scoped to THIS org (multi-tenant
  // safety — never add another org's admins as participants).
  const { data: kase } = await supabase
    .from("cases")
    .select("org_id, assigned_sales_id, assigned_paralegal_id")
    .eq("id", caseId)
    .maybeSingle();
  const orgId = kase?.org_id ?? null;
  if (!orgId) {
    return { orgId: null, caseMemberIds: [], paralegalId: null, salesId: null, adminIds: [] };
  }

  const [{ data: members }, { data: admins }] = await Promise.all([
    supabase
      .from("case_members")
      .select("user_id, users!inner(kind, is_active)")
      .eq("case_id", caseId)
      .eq("users.kind", "client")
      .eq("users.is_active", true),
    supabase
      .from("staff_profiles")
      .select("user_id, users!inner(is_active, org_id)")
      .eq("role", "admin")
      .eq("users.is_active", true)
      .eq("users.org_id", orgId),
  ]);

  return {
    orgId,
    caseMemberIds: (members ?? []).map((m) => m.user_id),
    paralegalId: kase?.assigned_paralegal_id ?? null,
    salesId: kase?.assigned_sales_id ?? null,
    adminIds: (admins ?? []).map((a) => a.user_id),
  };
}

/** Returns the user's locale (for translateMessage target). */
export async function getUserLocale(userId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("users").select("locale").eq("id", userId).maybeSingle();
  return data?.locale ?? "es";
}

/** Returns the org_id of the case that owns an installment-less case lookup. */
export async function findCaseOrgId(caseId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("cases").select("org_id").eq("id", caseId).maybeSingle();
  return data?.org_id ?? null;
}
