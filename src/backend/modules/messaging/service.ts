/**
 * Messaging module — service layer (DOC-46).
 *
 * Order: requireParticipant/requireCaseAccess (cross-org + membership guard) →
 * Zod → domain → repo (service client) → writeAudit → appEvents.
 *
 * @module messaging/service
 */

import { z } from "zod";
import { can, requireCaseAccess, AuthzError } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { appEvents } from "@/backend/platform/events";
import {
  createSignedUploadUrl,
  createSignedDownloadUrl,
  validateUploadedObject,
} from "@/backend/platform/storage";
import { limitMessagingUploadUrl } from "@/backend/platform/ratelimit";
import { writeAudit } from "@/backend/modules/audit";
import { translateText } from "@/backend/modules/ai-engine";

import {
  computeCaseParticipantIds,
  validateAttachmentRefs,
  renderSystemMessage,
  senderColor,
  initialsOf,
  conversationSnippet,
  type ConversationScope,
  type SystemMessageKey,
  type AttachmentRef,
} from "./domain";
import {
  findCaseConversation,
  findConversationById,
  findConversationByTitle,
  insertConversation,
  touchLastMessageAt,
  listParticipantIds,
  listParticipantsWithKind,
  loadParticipantProfiles,
  listActiveStaffIds,
  listActiveStaffProfiles,
  listConversationsForUser,
  getServicesInfo,
  getCaseChatPreview,
  isParticipant,
  getParticipant,
  addParticipants,
  removeParticipant as repoRemoveParticipant,
  markReadMonotonic,
  insertMessage,
  findMessageById,
  setMessageTranslation,
  listMessages,
  countUnreadAggregate,
  loadCaseParticipantSources,
  getUserLocale,
  type ConversationRow,
  type MessageRow,
} from "./repository";
import { getCasesForClient } from "@/backend/modules/cases";

const ADMIN_BUCKET = "chat-attachments";

// Lenient UUID (matches seed/structured ids that strict z.uuid() rejects) — same
// pattern as cases/expediente modules.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const zUuid = z.string().regex(UUID_RE, "uuid");

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class MessagingError extends Error {
  constructor(
    public readonly code:
      | "CONVERSATION_NOT_FOUND"
      | "MESSAGE_NOT_FOUND"
      | "NOT_PARTICIPANT"
      | "EMPTY_MESSAGE"
      | "ATTACHMENT_INVALID"
      | "LAST_STAFF_CANNOT_LEAVE"
      | "CLIENT_CANNOT_LEAVE"
      | "RATE_LIMITED"
      | "SCOPE_INVALID",
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "MessagingError";
  }
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/** A participant with presentation fields (group header, roster, sender colors). */
export interface ParticipantProfile {
  userId: string;
  name: string;
  roleLabel: string | null;
  kind: string; // 'client' | 'staff'
  initials: string;
  color: string;
}

/** One row of the staff inbox (PROMPT-VAN-07) or a client inbox. */
export interface ConversationSummaryDto {
  conversationId: string;
  scope: ConversationScope;
  title: string | null;
  caseId: string | null;
  caseNumber: string | null;
  name: string;
  initials: string;
  color: string;
  serviceChip: string | null;
  snippet: string;
  lastMessageAt: string | null;
  unread: number;
}

/** The staff inbox split into the two prototype tabs. */
export interface ConversationListDto {
  clients: ConversationSummaryDto[];
  team: ConversationSummaryDto[];
}

export interface ConversationThreadDto {
  conversation: { id: string; scope: ConversationScope; caseId: string | null; title: string | null };
  meUserId: string;
  messages: MessageRow[]; // chronological ASC within the page
  nextCursor: string | null; // older messages
  participantIds: string[];
  /** Participants with name/role/initials/color for the group header + roster. */
  participants: ParticipantProfile[];
  myLastReadAt: string | null;
  /**
   * Whether the viewer may post. True for conversation participants and for
   * staff admins (who post via the requireParticipant admin override). Staff
   * with case access but no participation (e.g. finance) can read the thread
   * via requireCaseAccess but must NOT see a composer that would always fail.
   */
  viewerCanPost: boolean;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Staff admins bypass the participant check (may read AND post on any thread of
 * their org). Single source of truth shared by `requireParticipant` (the write
 * guard) and `buildThreadDto.viewerCanPost` (the UI hint) so the two never drift.
 */
function isStaffAdmin(actor: Actor): boolean {
  return actor.kind === "staff" && actor.role === "admin";
}

async function requireParticipant(actor: Actor, conversationId: string): Promise<ConversationRow> {
  const conv = await findConversationById(conversationId);
  if (!conv) throw new MessagingError("CONVERSATION_NOT_FOUND");
  if (conv.org_id !== actor.orgId) throw new AuthzError("cross_org_access_denied");
  if (!isStaffAdmin(actor) && !(await isParticipant(conversationId, actor.userId))) {
    throw new MessagingError("NOT_PARTICIPANT");
  }
  return conv;
}

// ---------------------------------------------------------------------------
// ensureCaseConversation (system-level; consumer + lazy) — idempotent
// ---------------------------------------------------------------------------

export async function ensureCaseConversation(caseId: string): Promise<ConversationRow> {
  const sources = await loadCaseParticipantSources(caseId);
  if (!sources.orgId) throw new MessagingError("CONVERSATION_NOT_FOUND", { caseId });

  let conv = await findCaseConversation(caseId);
  if (!conv) {
    const { row, conflict } = await insertConversation({ orgId: sources.orgId, scope: "case", caseId });
    // On unique-constraint race, another insert won — re-read the winner.
    conv = conflict ? await findCaseConversation(caseId) : row;
    if (!conv) throw new MessagingError("CONVERSATION_NOT_FOUND", { caseId });
  }

  // Self-healing: reconcile participants on EVERY ensure (fresh insert, lost
  // race, and already-existing) so the set always mirrors the case's current
  // assignments. This is what keeps the paralegal added at the Legal handoff in
  // the thread even though the conversation was created earlier (in Sales, when
  // assigned_paralegal_id was still null). addParticipants is idempotent
  // (upsert ignoreDuplicates), so this never duplicates rows. (DOC-46 §2.1/§3.5)
  await addParticipants(conv.id, computeCaseParticipantIds(sources));
  return conv;
}

/**
 * Reconcile a case conversation's participant set with the case's current
 * assignments (client members ∪ paralegal ∪ sales ∪ org admins). Idempotent.
 * No-op when the conversation doesn't exist yet — it will be created later with
 * the correct set via `ensureCaseConversation` (downpayment.confirmed consumer
 * or first read). Consumed on `case.owner_changed` so a reassignment/handoff
 * adds the newly-assigned paralegal without a manual step (DOC-46 §3.5/§5.2).
 */
export async function syncCaseParticipants(caseId: string): Promise<void> {
  const conv = await findCaseConversation(caseId);
  if (!conv) return;
  const sources = await loadCaseParticipantSources(caseId);
  if (!sources.orgId) return;
  await addParticipants(conv.id, computeCaseParticipantIds(sources));
}

// ---------------------------------------------------------------------------
// Internal team conversations (staff panel "Equipo" tab) — idempotent
// ---------------------------------------------------------------------------

/** Reserved title marking the org-wide all-staff group ("Equipo UsaLatinoPrime"). */
const TEAM_TITLE = "__team__";
/** Reserved title for a deterministic 1:1 staff DM (sorted so it's order-free). */
function dmTitle(a: string, b: string): string {
  return `__dm__:${[a, b].sort().join("|")}`;
}

/**
 * The org-wide all-staff group, created lazily with every active staff member.
 * Staff-only: `can()` rejects clients (Server Actions are public POST endpoints).
 */
export async function ensureTeamConversation(actor: Actor): Promise<ConversationRow> {
  can(actor, "messaging", "view");
  const orgId = actor.orgId;
  const existing = await findConversationByTitle(orgId, "support", TEAM_TITLE);
  if (existing) return existing;

  const staffIds = await listActiveStaffIds(orgId);
  const { row, conflict } = await insertConversation({ orgId, scope: "support", title: TEAM_TITLE });
  if (conflict) {
    const won = await findConversationByTitle(orgId, "support", TEAM_TITLE);
    if (!won) throw new MessagingError("CONVERSATION_NOT_FOUND");
    await addParticipants(won.id, staffIds);
    return won;
  }
  if (!row) throw new MessagingError("CONVERSATION_NOT_FOUND");
  await addParticipants(row.id, staffIds);
  return row;
}

/** A 1:1 internal thread between the actor and another staff member (lazy). */
export async function ensureStaffDirectConversation(
  actor: Actor,
  otherUserId: string,
): Promise<ConversationRow> {
  can(actor, "messaging", "view");
  // The target must be active staff in the actor's org — never a client or a
  // cross-org user (addParticipants bypasses RLS, so guard it here).
  const staffIds = await listActiveStaffIds(actor.orgId);
  if (!staffIds.includes(otherUserId)) throw new AuthzError("wrong_kind");
  const title = dmTitle(actor.userId, otherUserId);
  const existing = await findConversationByTitle(actor.orgId, "support", title);
  if (existing) return existing;

  const { row, conflict } = await insertConversation({ orgId: actor.orgId, scope: "support", title });
  if (conflict) {
    const won = await findConversationByTitle(actor.orgId, "support", title);
    if (!won) throw new MessagingError("CONVERSATION_NOT_FOUND");
    await addParticipants(won.id, [actor.userId, otherUserId]);
    return won;
  }
  if (!row) throw new MessagingError("CONVERSATION_NOT_FOUND");
  await addParticipants(row.id, [actor.userId, otherUserId]);
  return row;
}

/**
 * Inserts a closed-registry system message. NEVER emits message.sent, NEVER
 * notifies (the originating milestone already notified) — DOC-46 §2.4.
 */
export async function postSystemMessage(
  caseId: string,
  key: SystemMessageKey,
  vars?: Record<string, string | number>,
): Promise<void> {
  const conv = await ensureCaseConversation(caseId);
  const { body, bodyTranslated } = renderSystemMessage(key, vars);
  const msg = await insertMessage({
    conversationId: conv.id,
    senderUserId: null,
    kind: "system",
    body,
    bodyTranslated,
  });
  await touchLastMessageAt(conv.id, msg.created_at);
}

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

const AttachmentRefSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
});

const SendMessageSchema = z.object({
  conversationId: zUuid,
  body: z.string().max(5000).optional(),
  uploadRefs: z.array(AttachmentRefSchema).max(10).optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export async function sendMessage(actor: Actor, input: SendMessageInput): Promise<MessageRow> {
  const parsed = SendMessageSchema.parse(input);
  const conv = await requireParticipant(actor, parsed.conversationId);

  const refs = validateAttachmentRefs(parsed.uploadRefs ?? []);
  const body = parsed.body?.trim() || null;
  if (!body && refs.length === 0) throw new MessagingError("EMPTY_MESSAGE");

  const msg = await insertMessage({
    conversationId: conv.id,
    senderUserId: actor.userId,
    kind: refs.length > 0 ? "attachment" : "text",
    body,
    attachments: refs as unknown as import("@/shared/database.types").Json,
  });
  await touchLastMessageAt(conv.id, msg.created_at);
  await writeAudit(actor, "messaging.message.sent", "messages", msg.id, {
    after: { conversationId: conv.id, kind: msg.kind },
  });

  const recipientIds = (await listParticipantIds(conv.id)).filter((id) => id !== actor.userId);
  await appEvents.emitAndWait({
    type: "message.sent",
    payload: {
      messageId: msg.id,
      conversationId: conv.id,
      scope: conv.scope as ConversationScope,
      caseId: conv.case_id,
      senderUserId: actor.userId,
      orgId: conv.org_id,
      recipientIds,
    },
    occurredAt: new Date(),
  });
  return msg;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function buildThreadDto(
  actor: Actor,
  conv: ConversationRow,
  opts?: { cursor?: string; limit?: number },
): Promise<ConversationThreadDto> {
  const page = await listMessages(conv.id, opts ?? {});
  const participantIds = await listParticipantIds(conv.id);
  const profiles = await loadParticipantProfiles(conv.id, conv.org_id);
  const me = await getParticipant(conv.id, actor.userId);
  const participants: ParticipantProfile[] = profiles.map((p) => ({
    userId: p.userId,
    name: p.name,
    roleLabel: p.roleLabel,
    kind: p.kind,
    initials: initialsOf(p.name),
    color: senderColor(p.userId),
  }));
  return {
    conversation: { id: conv.id, scope: conv.scope as ConversationScope, caseId: conv.case_id, title: conv.title },
    meUserId: actor.userId,
    messages: [...page.items].reverse(), // ASC for display
    nextCursor: page.nextCursor,
    participantIds,
    participants,
    myLastReadAt: me?.last_read_at ?? null,
    viewerCanPost: isStaffAdmin(actor) || participantIds.includes(actor.userId),
  };
}

export async function getThread(
  actor: Actor,
  conversationId: string,
  opts?: { cursor?: string; limit?: number },
): Promise<ConversationThreadDto> {
  const conv = await requireParticipant(actor, conversationId);
  return buildThreadDto(actor, conv, opts);
}

export async function getCaseThread(
  actor: Actor,
  caseId: string,
  opts?: { cursor?: string; limit?: number },
): Promise<ConversationThreadDto> {
  await requireCaseAccess(actor, caseId);
  const conv = await ensureCaseConversation(caseId);
  return buildThreadDto(actor, conv, opts);
}

export async function loadMoreMessages(
  actor: Actor,
  conversationId: string,
  cursor: string,
): Promise<{ messages: MessageRow[]; nextCursor: string | null }> {
  await requireParticipant(actor, conversationId);
  const page = await listMessages(conversationId, { cursor });
  return { messages: [...page.items].reverse(), nextCursor: page.nextCursor };
}

/** Messages newer than `afterIso` (polling fallback + realtime catch-up). */
export async function listSince(
  actor: Actor,
  conversationId: string,
  afterIso: string,
): Promise<MessageRow[]> {
  await requireParticipant(actor, conversationId);
  // listMessages is desc keyset; fetch a page and filter > afterIso, ASC.
  const page = await listMessages(conversationId, { limit: 100 });
  return page.items.filter((m) => m.created_at > afterIso).reverse();
}

// ---------------------------------------------------------------------------
// markRead + badge
// ---------------------------------------------------------------------------

export async function markRead(actor: Actor, conversationId: string): Promise<void> {
  await requireParticipant(actor, conversationId);
  await markReadMonotonic(conversationId, actor.userId, new Date().toISOString());
}

export async function getUnreadBadge(actor: Actor): Promise<{ total: number }> {
  return { total: await countUnreadAggregate(actor.userId) };
}

// ---------------------------------------------------------------------------
// Inbox list (staff panel Clientes/Equipo — PROMPT-VAN-07)
// ---------------------------------------------------------------------------

/**
 * The viewer's conversations, split into the two prototype tabs: `clients`
 * (scope='case') and `team` (internal support/lead threads). Each row is
 * enriched with initials/color/snippet for the list UI.
 */
export async function listConversations(actor: Actor): Promise<ConversationListDto> {
  // No `can()` guard: this returns ONLY the caller's own conversations
  // (filtered by actor.userId), so it is safe for any authenticated actor —
  // staff today, clients if a client inbox is ever wired to it.
  const rows = await listConversationsForUser(actor.userId);
  const dtos: ConversationSummaryDto[] = rows.map((r) => ({
    conversationId: r.conversationId,
    scope: r.scope,
    title: r.title,
    caseId: r.caseId,
    caseNumber: r.caseNumber,
    name: r.peerName,
    initials: initialsOf(r.peerName),
    color: senderColor(r.conversationId),
    serviceChip: r.serviceChip,
    snippet: conversationSnippet(r.lastMessage, actor.userId),
    lastMessageAt: r.lastMessageAt,
    unread: r.unread,
  }));
  return {
    clients: dtos.filter((d) => d.scope === "case"),
    team: dtos.filter((d) => d.scope === "support" || d.scope === "lead"),
  };
}

/** Active staff directory entry (Equipo tab — start a 1:1). */
export interface StaffDirectoryEntry {
  userId: string;
  name: string;
  roleLabel: string | null;
  initials: string;
  color: string;
}

/** Other active staff in the org, enriched for the Equipo-tab DM list. */
export async function listStaffDirectory(actor: Actor): Promise<StaffDirectoryEntry[]> {
  can(actor, "messaging", "view"); // staff PII (names/roles) — never expose to clients
  const rows = await listActiveStaffProfiles(actor.orgId, actor.userId);
  return rows.map((p) => ({
    userId: p.userId,
    name: p.name,
    roleLabel: p.roleLabel,
    initials: initialsOf(p.name),
    color: senderColor(p.userId),
  }));
}

// ---------------------------------------------------------------------------
// Client case-chat list (one chat per case — client account level, DOC-51)
// ---------------------------------------------------------------------------

/** One row of the client's "your chats" list — one per case the client has. */
export interface ClientCaseChatDto {
  caseId: string;
  conversationId: string | null;
  serviceName: string | null;
  serviceColor: string | null;
  serviceIcon: string | null;
  caseNumber: string | null;
  snippet: string;
  unread: number;
  lastMessageAt: string | null;
}

/**
 * One chat per case the client has, enriched with the service (name/color/icon)
 * and a conversation preview (snippet/unread). Based on the client's CASES — not
 * on existing conversations — so a case without a chat yet still appears (its
 * conversation is created lazily on first open). No `can()` guard: returns only
 * the caller's own cases (getCasesForClient is RLS-scoped + client-only).
 */
export async function listClientCaseChats(actor: Actor): Promise<ClientCaseChatDto[]> {
  const page = await getCasesForClient(actor, { limit: 50 });
  const cases = page.items;
  const services = await getServicesInfo(cases.map((c) => c.service_id));

  const rows = await Promise.all(
    cases.map(async (c) => {
      const preview = await getCaseChatPreview(c.id, actor.userId);
      const svc = services.get(c.service_id);
      return {
        caseId: c.id,
        conversationId: preview.conversationId,
        serviceName: svc?.name ?? null,
        serviceColor: svc?.color ?? null,
        serviceIcon: svc?.icon ?? null,
        caseNumber: c.case_number,
        snippet: conversationSnippet(preview.lastMessage, actor.userId),
        unread: preview.unread,
        lastMessageAt: preview.lastMessageAt,
      } satisfies ClientCaseChatDto;
    }),
  );

  // Most recent activity first; cases without messages keep their case order.
  rows.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  return rows;
}

// ---------------------------------------------------------------------------
// translateMessage (cache-first; never overwrites body)
// ---------------------------------------------------------------------------

export async function translateMessage(
  actor: Actor,
  messageId: string,
): Promise<{ lang: "en" | "es"; text: string }> {
  const msg = await findMessageById(messageId);
  if (!msg) throw new MessagingError("MESSAGE_NOT_FOUND");
  await requireParticipant(actor, msg.conversation_id);

  const target: "en" | "es" = (await getUserLocale(actor.userId)) === "en" ? "en" : "es";
  const cached = msg.body_translated as { lang?: string; text?: string } | null;
  if (cached?.lang === target && typeof cached.text === "string") {
    return { lang: target, text: cached.text };
  }
  if (!msg.body) return { lang: target, text: "" };

  const { text } = await translateText({
    text: msg.body,
    direction: target === "en" ? "es-en" : "en-es",
  });
  await setMessageTranslation(messageId, { lang: target, text });
  return { lang: target, text };
}

// ---------------------------------------------------------------------------
// Participants (staff)
// ---------------------------------------------------------------------------

export async function addParticipant(actor: Actor, conversationId: string, userId: string): Promise<void> {
  can(actor, "messaging", "edit");
  await requireParticipant(actor, conversationId);
  await addParticipants(conversationId, [userId]);
  await writeAudit(actor, "messaging.participant.added", "conversations", conversationId, {
    after: { userId },
  });
}

export async function removeParticipant(actor: Actor, conversationId: string, userId: string): Promise<void> {
  can(actor, "messaging", "edit");
  const conv = await requireParticipant(actor, conversationId);

  const participants = await listParticipantsWithKind(conversationId);
  const target = participants.find((p) => p.userId === userId);

  // Client of a case conversation can never be removed.
  if (conv.scope === "case" && target?.kind === "client") {
    throw new MessagingError("CLIENT_CANNOT_LEAVE");
  }
  // Never leave a conversation without staff.
  const staffCount = participants.filter((p) => p.kind === "staff").length;
  if (target?.kind === "staff" && staffCount <= 1) {
    throw new MessagingError("LAST_STAFF_CANNOT_LEAVE");
  }

  await repoRemoveParticipant(conversationId, userId);
  await writeAudit(actor, "messaging.participant.removed", "conversations", conversationId, {
    after: { userId },
  });
}

// ---------------------------------------------------------------------------
// Attachments (signed-URL cycle, bucket chat-attachments)
// ---------------------------------------------------------------------------

const UploadUrlSchema = z.object({
  conversationId: zUuid,
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1),
});

export async function getAttachmentUploadUrl(
  actor: Actor,
  input: z.infer<typeof UploadUrlSchema>,
): Promise<{ signedUrl: string; path: string }> {
  const parsed = UploadUrlSchema.parse(input);
  await requireParticipant(actor, parsed.conversationId);

  const rl = await limitMessagingUploadUrl(actor.userId);
  if (!rl.allowed) throw new MessagingError("RATE_LIMITED");

  const sanitized = parsed.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${parsed.conversationId}/${Date.now()}-${sanitized}`;
  return createSignedUploadUrl(ADMIN_BUCKET, path);
}

const ConfirmAttachmentSchema = z.object({
  conversationId: zUuid,
  path: z.string().min(1),
  name: z.string().min(1).max(200),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
});

export async function confirmAttachment(
  actor: Actor,
  input: z.infer<typeof ConfirmAttachmentSchema>,
): Promise<AttachmentRef> {
  const parsed = ConfirmAttachmentSchema.parse(input);
  await requireParticipant(actor, parsed.conversationId);

  // Path must be inside this conversation's prefix (no traversal/cross-thread).
  if (!parsed.path.startsWith(`${parsed.conversationId}/`)) {
    throw new MessagingError("ATTACHMENT_INVALID");
  }

  const validation = await validateUploadedObject(ADMIN_BUCKET, parsed.path, "chat-attachments");
  if (!validation.ok) throw new MessagingError("ATTACHMENT_INVALID", { reason: validation.reason });

  return { path: parsed.path, name: parsed.name, mime: parsed.mime, size: parsed.size };
}

export async function getAttachmentDownloadUrl(
  actor: Actor,
  input: { conversationId: string; path: string },
): Promise<{ url: string }> {
  await requireParticipant(actor, input.conversationId);
  if (!input.path.startsWith(`${input.conversationId}/`)) {
    throw new MessagingError("ATTACHMENT_INVALID");
  }
  const url = await createSignedDownloadUrl(ADMIN_BUCKET, input.path);
  return { url };
}
