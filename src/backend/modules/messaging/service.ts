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
  type ConversationScope,
  type SystemMessageKey,
  type AttachmentRef,
} from "./domain";
import {
  findCaseConversation,
  findConversationById,
  insertConversation,
  touchLastMessageAt,
  listParticipantIds,
  listParticipantsWithKind,
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

export interface ConversationThreadDto {
  conversation: { id: string; scope: ConversationScope; caseId: string | null; title: string | null };
  meUserId: string;
  messages: MessageRow[]; // chronological ASC within the page
  nextCursor: string | null; // older messages
  participantIds: string[];
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
  const existing = await findCaseConversation(caseId);
  if (existing) return existing;

  const sources = await loadCaseParticipantSources(caseId);
  if (!sources.orgId) throw new MessagingError("CONVERSATION_NOT_FOUND", { caseId });

  const { row, conflict } = await insertConversation({ orgId: sources.orgId, scope: "case", caseId });

  if (conflict) {
    // Lost the race — another insert won. Re-read and ensure participants.
    const won = await findCaseConversation(caseId);
    if (!won) throw new MessagingError("CONVERSATION_NOT_FOUND", { caseId });
    await addParticipants(won.id, computeCaseParticipantIds(sources));
    return won;
  }
  if (!row) throw new MessagingError("CONVERSATION_NOT_FOUND", { caseId });

  await addParticipants(row.id, computeCaseParticipantIds(sources));
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
  const me = await getParticipant(conv.id, actor.userId);
  return {
    conversation: { id: conv.id, scope: conv.scope as ConversationScope, caseId: conv.case_id, title: conv.title },
    meUserId: actor.userId,
    messages: [...page.items].reverse(), // ASC for display
    nextCursor: page.nextCursor,
    participantIds,
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
