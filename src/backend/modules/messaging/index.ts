/**
 * Messaging module — public API (module-pub boundary).
 *
 * Server actions live in ./actions.ts. System-level functions
 * (ensureCaseConversation, postSystemMessage) are consumed by register-consumers.
 */

export {
  // system-level (consumers)
  ensureCaseConversation,
  postSystemMessage,
  // use cases
  sendMessage,
  getThread,
  getCaseThread,
  loadMoreMessages,
  listSince,
  markRead,
  getUnreadBadge,
  translateMessage,
  addParticipant,
  removeParticipant,
  getAttachmentUploadUrl,
  confirmAttachment,
  getAttachmentDownloadUrl,
  MessagingError,
} from "./service";

export type { ConversationThreadDto, SendMessageInput } from "./service";
export type {
  ConversationScope,
  MessageKind,
  SystemMessageKey,
  AttachmentRef,
} from "./domain";
export { isUnread, computeCaseParticipantIds, renderSystemMessage } from "./domain";
export type { ConversationRow, MessageRow } from "./repository";
export type { MessageSentEvent } from "./events";
