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

// ---------------------------------------------------------------------------
// Internal team conversations + inbox list (staff panel — PROMPT-VAN-07)
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof createServiceClient>;

/** Picks a display string from an i18n Json blob ({es,en}); es → en → first. */
function pickI18n(json: Json | null | undefined): string | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const v = o.es ?? o.en ?? Object.values(o)[0];
  return typeof v === "string" ? v : null;
}

/** Finds a conversation by its reserved title marker (team group / staff DM). */
export async function findConversationByTitle(
  orgId: string,
  scope: ConversationScope,
  title: string,
): Promise<ConversationRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("conversations")
    .select("*")
    .eq("org_id", orgId)
    .eq("scope", scope)
    .eq("title", title)
    .maybeSingle();
  return data ?? null;
}

/** Active staff user ids in an org (members of the all-staff group). */
export async function listActiveStaffIds(orgId: string): Promise<string[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("staff_profiles")
    .select("user_id, users!inner(org_id, is_active, kind)")
    .eq("users.org_id", orgId)
    .eq("users.is_active", true)
    .eq("users.kind", "staff");
  return (data ?? []).map((r) => r.user_id);
}

/** Active staff in the org (minus the viewer) — for the Equipo-tab DM directory. */
export async function listActiveStaffProfiles(
  orgId: string,
  excludeUserId: string,
): Promise<Array<{ userId: string; name: string; roleLabel: string | null }>> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("staff_profiles")
    .select("user_id, display_name, role, title_i18n, users!inner(org_id, is_active, kind)")
    .eq("users.org_id", orgId)
    .eq("users.is_active", true)
    .eq("users.kind", "staff")
    .neq("user_id", excludeUserId);
  return (data ?? []).map((s) => ({
    userId: s.user_id,
    name: s.display_name,
    roleLabel: pickI18n(s.title_i18n) ?? s.role,
  }));
}

export interface ParticipantProfileRaw {
  userId: string;
  name: string;
  roleLabel: string | null;
  kind: string;
}

/** Resolves name/role/kind for every participant of a conversation (org-scoped). */
export async function loadParticipantProfiles(
  conversationId: string,
  orgId: string,
): Promise<ParticipantProfileRaw[]> {
  const supabase = createServiceClient();
  const { data: parts } = await supabase
    .from("conversation_participants")
    .select("user_id, users!inner(kind, org_id)")
    .eq("conversation_id", conversationId)
    .eq("users.org_id", orgId);
  const rows = (parts ?? []) as unknown as Array<{
    user_id: string;
    users: { kind: string } | Array<{ kind: string }>;
  }>;
  const ids = rows.map((r) => r.user_id);
  if (ids.length === 0) return [];
  const kindOf = new Map(
    rows.map((r) => [r.user_id, (Array.isArray(r.users) ? r.users[0] : r.users)?.kind ?? "client"]),
  );

  const [{ data: staff }, { data: clients }] = await Promise.all([
    supabase.from("staff_profiles").select("user_id, display_name, role, title_i18n").in("user_id", ids),
    supabase.from("client_profiles").select("user_id, first_name, last_name, preferred_name").in("user_id", ids),
  ]);
  const staffMap = new Map((staff ?? []).map((s) => [s.user_id, s]));
  const clientMap = new Map((clients ?? []).map((c) => [c.user_id, c]));

  return ids.map((id) => {
    const s = staffMap.get(id);
    const c = clientMap.get(id);
    if (s) return { userId: id, name: s.display_name, roleLabel: pickI18n(s.title_i18n) ?? s.role, kind: "staff" };
    if (c) {
      const name = c.preferred_name?.trim() || `${c.first_name} ${c.last_name}`.trim();
      return { userId: id, name: name || "Cliente", roleLabel: null, kind: "client" };
    }
    return { userId: id, name: "Usuario", roleLabel: null, kind: kindOf.get(id) ?? "client" };
  });
}

export interface ConversationSummaryRaw {
  conversationId: string;
  scope: ConversationScope;
  title: string | null;
  caseId: string | null;
  caseNumber: string | null;
  serviceChip: string | null;
  peerName: string;
  lastMessageAt: string | null;
  unread: number;
  lastMessage:
    | {
        kind: MessageKind;
        body: string | null;
        senderUserId: string | null;
        senderName: string | null;
        attachmentName: string | null;
      }
    | null;
}

/** Display label + service chip for a conversation, from the viewer's side. */
async function resolvePeer(
  supabase: Db,
  conv: { id: string; scope: string; title: string | null; case_id: string | null },
  viewerId: string,
): Promise<{ name: string; serviceChip: string | null; caseNumber: string | null }> {
  if (conv.scope === "case" && conv.case_id) {
    const { data: kase } = await supabase
      .from("cases")
      .select("primary_client_id, service_id, case_number")
      .eq("id", conv.case_id)
      .maybeSingle();
    if (!kase) return { name: "Cliente", serviceChip: null, caseNumber: null };
    const [{ data: cp }, { data: svc }] = await Promise.all([
      supabase
        .from("client_profiles")
        .select("first_name, last_name, preferred_name")
        .eq("user_id", kase.primary_client_id)
        .maybeSingle(),
      supabase.from("services").select("label_i18n").eq("id", kase.service_id).maybeSingle(),
    ]);
    const name = cp ? cp.preferred_name?.trim() || `${cp.first_name} ${cp.last_name}`.trim() : "Cliente";
    return { name: name || "Cliente", serviceChip: pickI18n(svc?.label_i18n), caseNumber: kase.case_number };
  }
  if (conv.scope === "support") {
    if (conv.title === "__team__") return { name: "Equipo UsaLatinoPrime", serviceChip: null, caseNumber: null };
    if (conv.title?.startsWith("__dm__:")) {
      const { data: others } = await supabase
        .from("conversation_participants")
        .select("user_id")
        .eq("conversation_id", conv.id)
        .neq("user_id", viewerId);
      const otherId = (others ?? [])[0]?.user_id;
      if (otherId) {
        const { data: sp } = await supabase
          .from("staff_profiles")
          .select("display_name")
          .eq("user_id", otherId)
          .maybeSingle();
        if (sp) return { name: sp.display_name, serviceChip: null, caseNumber: null };
      }
      return { name: "Mensaje directo", serviceChip: null, caseNumber: null };
    }
    return { name: conv.title ?? "Soporte", serviceChip: null, caseNumber: null };
  }
  return { name: conv.title ?? "Prospecto", serviceChip: null, caseNumber: null };
}

async function resolveLastMessage(
  supabase: Db,
  conversationId: string,
): Promise<ConversationSummaryRaw["lastMessage"]> {
  const { data } = await supabase
    .from("messages")
    .select("kind, body, sender_user_id, attachments")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  let senderName: string | null = null;
  if (data.sender_user_id) {
    const { data: sp } = await supabase
      .from("staff_profiles")
      .select("display_name")
      .eq("user_id", data.sender_user_id)
      .maybeSingle();
    if (sp) senderName = sp.display_name;
    else {
      const { data: cp } = await supabase
        .from("client_profiles")
        .select("first_name, preferred_name")
        .eq("user_id", data.sender_user_id)
        .maybeSingle();
      if (cp) senderName = cp.preferred_name?.trim() || cp.first_name;
    }
  }

  const atts = Array.isArray(data.attachments) ? (data.attachments as unknown[]) : [];
  const first = atts[0] as { name?: unknown } | undefined;
  const attachmentName = first && typeof first.name === "string" ? first.name : null;

  return {
    kind: data.kind as MessageKind,
    body: data.body,
    senderUserId: data.sender_user_id,
    senderName,
    attachmentName,
  };
}

async function countUnreadForConversation(
  supabase: Db,
  conversationId: string,
  userId: string,
  lastReadAt: string | null,
): Promise<number> {
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .neq("kind", "system")
    .neq("sender_user_id", userId)
    .gt("created_at", lastReadAt ?? "1970-01-01T00:00:00.000Z");
  return count ?? 0;
}

/** Service display info (name/color/icon) for the client case-chat list rows. */
export async function getServicesInfo(
  serviceIds: string[],
): Promise<Map<string, { name: string | null; color: string | null; icon: string | null }>> {
  const map = new Map<string, { name: string | null; color: string | null; icon: string | null }>();
  const ids = [...new Set(serviceIds.filter(Boolean))];
  if (ids.length === 0) return map;
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("services").select("id, label_i18n, color, icon").in("id", ids);
  if (error) throw new Error(`messaging.repository: getServicesInfo failed — ${error.message}`);
  for (const s of data ?? []) map.set(s.id, { name: pickI18n(s.label_i18n), color: s.color, icon: s.icon });
  return map;
}

/**
 * Conversation preview for one case (last message + unread for the viewer).
 * Returns conversationId=null when the case conversation does not exist yet —
 * it is created lazily when the chat is first opened (ensureCaseConversation).
 */
export async function getCaseChatPreview(
  caseId: string,
  userId: string,
): Promise<{
  conversationId: string | null;
  lastMessage: ConversationSummaryRaw["lastMessage"];
  unread: number;
  lastMessageAt: string | null;
}> {
  const conv = await findCaseConversation(caseId);
  if (!conv) return { conversationId: null, lastMessage: null, unread: 0, lastMessageAt: null };
  const supabase = createServiceClient();
  const part = await getParticipant(conv.id, userId);
  const [last, unread] = await Promise.all([
    resolveLastMessage(supabase, conv.id),
    countUnreadForConversation(supabase, conv.id, userId, part?.last_read_at ?? null),
  ]);
  return { conversationId: conv.id, lastMessage: last, unread, lastMessageAt: conv.last_message_at };
}

/**
 * The viewer's conversations with everything the inbox list needs (peer label,
 * service chip, last-message preview, unread count), newest first.
 *
 * PERF / TODO(scale): this fans out ~5-6 queries per conversation (resolvePeer +
 * resolveLastMessage + countUnread). Fine for the demo and for staff with a
 * handful of threads, but an ORG ADMIN participates in every case conversation,
 * so at hundreds of cases this is an N+1 hot spot. Before production scale,
 * replace with a single aggregated SQL view / RPC (join cases+clients+services+
 * last message + unread in one round-trip).
 */
export async function listConversationsForUser(userId: string): Promise<ConversationSummaryRaw[]> {
  const supabase = createServiceClient();
  const { data: parts } = await supabase
    .from("conversation_participants")
    .select("conversation_id, last_read_at")
    .eq("user_id", userId);
  const memberships = (parts ?? []) as Array<{ conversation_id: string; last_read_at: string | null }>;
  if (memberships.length === 0) return [];
  const convIds = memberships.map((m) => m.conversation_id);
  const lastReadByConv = new Map(memberships.map((m) => [m.conversation_id, m.last_read_at]));

  const { data: convs } = await supabase
    .from("conversations")
    .select("id, scope, title, case_id, last_message_at")
    .in("id", convIds);
  const conversations = (convs ?? []) as Array<{
    id: string;
    scope: string;
    title: string | null;
    case_id: string | null;
    last_message_at: string | null;
  }>;

  const out = await Promise.all(
    conversations.map(async (c) => {
      const [peer, last, unread] = await Promise.all([
        resolvePeer(supabase, c, userId),
        resolveLastMessage(supabase, c.id),
        countUnreadForConversation(supabase, c.id, userId, lastReadByConv.get(c.id) ?? null),
      ]);
      return {
        conversationId: c.id,
        scope: c.scope as ConversationScope,
        title: c.title,
        caseId: c.case_id,
        caseNumber: peer.caseNumber,
        serviceChip: peer.serviceChip,
        peerName: peer.name,
        lastMessageAt: c.last_message_at,
        unread,
        lastMessage: last,
      } satisfies ConversationSummaryRaw;
    }),
  );

  out.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  return out;
}
