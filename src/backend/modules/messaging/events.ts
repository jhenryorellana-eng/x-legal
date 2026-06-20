/**
 * Messaging module domain events.
 *
 * - message.sent — emitted by sendMessage (text/attachment only; NEVER by system
 *   messages). Consumed by notifications (anti-burst) in Ola 7b.
 */

import type { ConversationScope } from "./domain";

export interface MessageSentEvent {
  type: "message.sent";
  payload: {
    messageId: string;
    conversationId: string;
    scope: ConversationScope;
    caseId: string | null;
    senderUserId: string;
    orgId: string;
    recipientIds: string[];
  };
  occurredAt: Date;
}

export type MessagingEvent = MessageSentEvent;
