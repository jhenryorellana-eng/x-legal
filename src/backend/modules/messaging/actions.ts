"use server";

/**
 * Messaging module — server actions ("use server"; importable by client UI).
 *
 * Each action: requireActor() → service → typed ActionResult. Clones billing/actions.
 * NOTE: a "use server" file may only export async functions — ActionResult and the
 * ok/fail helpers are kept internal.
 */

import { requireActor, AuthzError } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import { MessagingError } from "./service";
import * as svc from "./service";
import type {
  ConversationThreadDto,
  ConversationListDto,
  StaffDirectoryEntry,
  ClientCaseChatDto,
  SendMessageInput,
} from "./service";
import type { AttachmentRef, MessageRow } from "./index";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

function fail(err: unknown): ActionResult<never> {
  if (err instanceof MessagingError) {
    logger.warn({ code: err.code, details: err.details }, "messaging action: domain error");
    return { success: false, error: { code: err.code, message: err.code } };
  }
  if (err instanceof AuthzError) {
    return { success: false, error: { code: err.reason ?? "UNAUTHORIZED", message: "Unauthorized" } };
  }
  logger.error({ err }, "messaging action: unexpected error");
  return { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } };
}

export async function getCaseThreadAction(caseId: string): Promise<ActionResult<ConversationThreadDto>> {
  try {
    const actor = await requireActor();
    return ok(await svc.getCaseThread(actor, caseId));
  } catch (err) {
    return fail(err);
  }
}

export async function sendMessageAction(input: SendMessageInput): Promise<ActionResult<MessageRow>> {
  try {
    const actor = await requireActor();
    return ok(await svc.sendMessage(actor, input));
  } catch (err) {
    return fail(err);
  }
}

export async function loadMoreMessagesAction(
  conversationId: string,
  cursor: string,
): Promise<ActionResult<{ messages: MessageRow[]; nextCursor: string | null }>> {
  try {
    const actor = await requireActor();
    return ok(await svc.loadMoreMessages(actor, conversationId, cursor));
  } catch (err) {
    return fail(err);
  }
}

export async function listSinceAction(
  conversationId: string,
  afterIso: string,
): Promise<ActionResult<MessageRow[]>> {
  try {
    const actor = await requireActor();
    return ok(await svc.listSince(actor, conversationId, afterIso));
  } catch (err) {
    return fail(err);
  }
}

export async function markReadAction(conversationId: string): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.markRead(actor, conversationId);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

export async function getUnreadBadgeAction(): Promise<ActionResult<{ total: number }>> {
  try {
    const actor = await requireActor();
    return ok(await svc.getUnreadBadge(actor));
  } catch (err) {
    return fail(err);
  }
}

export async function listConversationsAction(): Promise<ActionResult<ConversationListDto>> {
  try {
    const actor = await requireActor();
    return ok(await svc.listConversations(actor));
  } catch (err) {
    return fail(err);
  }
}

export async function getConversationThreadAction(
  conversationId: string,
): Promise<ActionResult<ConversationThreadDto>> {
  try {
    const actor = await requireActor();
    return ok(await svc.getThread(actor, conversationId));
  } catch (err) {
    return fail(err);
  }
}

export async function listStaffDirectoryAction(): Promise<ActionResult<StaffDirectoryEntry[]>> {
  try {
    const actor = await requireActor();
    return ok(await svc.listStaffDirectory(actor));
  } catch (err) {
    return fail(err);
  }
}

export async function listClientCaseChatsAction(): Promise<ActionResult<ClientCaseChatDto[]>> {
  try {
    const actor = await requireActor();
    return ok(await svc.listClientCaseChats(actor));
  } catch (err) {
    return fail(err);
  }
}

export async function openTeamConversationAction(): Promise<ActionResult<ConversationThreadDto>> {
  try {
    const actor = await requireActor();
    const conv = await svc.ensureTeamConversation(actor);
    return ok(await svc.getThread(actor, conv.id));
  } catch (err) {
    return fail(err);
  }
}

export async function openStaffDirectConversationAction(
  otherUserId: string,
): Promise<ActionResult<ConversationThreadDto>> {
  try {
    const actor = await requireActor();
    const conv = await svc.ensureStaffDirectConversation(actor, otherUserId);
    return ok(await svc.getThread(actor, conv.id));
  } catch (err) {
    return fail(err);
  }
}

export async function translateMessageAction(
  messageId: string,
): Promise<ActionResult<{ lang: "en" | "es"; text: string }>> {
  try {
    const actor = await requireActor();
    return ok(await svc.translateMessage(actor, messageId));
  } catch (err) {
    return fail(err);
  }
}

export async function addParticipantAction(
  conversationId: string,
  userId: string,
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.addParticipant(actor, conversationId, userId);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

export async function removeParticipantAction(
  conversationId: string,
  userId: string,
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.removeParticipant(actor, conversationId, userId);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

export async function getAttachmentUploadUrlAction(input: {
  conversationId: string;
  filename: string;
  contentType: string;
}): Promise<ActionResult<{ signedUrl: string; path: string }>> {
  try {
    const actor = await requireActor();
    return ok(await svc.getAttachmentUploadUrl(actor, input));
  } catch (err) {
    return fail(err);
  }
}

export async function confirmAttachmentAction(input: {
  conversationId: string;
  path: string;
  name: string;
  mime: string;
  size: number;
}): Promise<ActionResult<AttachmentRef>> {
  try {
    const actor = await requireActor();
    return ok(await svc.confirmAttachment(actor, input));
  } catch (err) {
    return fail(err);
  }
}

export async function getAttachmentDownloadUrlAction(input: {
  conversationId: string;
  path: string;
}): Promise<ActionResult<{ url: string }>> {
  try {
    const actor = await requireActor();
    return ok(await svc.getAttachmentDownloadUrl(actor, input));
  } catch (err) {
    return fail(err);
  }
}
