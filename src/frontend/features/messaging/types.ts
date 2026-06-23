/**
 * Messaging view-model types (frontend). NO @/backend imports — data flows via VM.
 */

export interface ChatAttachmentVM {
  path: string;
  name: string;
  mime: string;
  size: number;
}

export interface ChatMessageVM {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  kind: "text" | "system" | "attachment" | "call_summary";
  body: string | null;
  bodyTranslated: { lang: string; text: string } | null;
  attachments: ChatAttachmentVM[];
  createdAt: string;
}

/** A participant with presentation fields (group header, roster, sender colors). */
export interface ParticipantVM {
  userId: string;
  name: string;
  roleLabel: string | null;
  kind: string; // 'client' | 'staff'
  initials: string;
  color: string;
}

export interface ChatThreadVM {
  conversationId: string;
  scope: string;
  meUserId: string;
  messages: ChatMessageVM[];
  nextCursor: string | null;
  myLastReadAt: string | null;
  participantIds: string[];
  /** Participants with name/role/initials/color for the group header + roster. */
  participants: ParticipantVM[];
  /** False for staff with case access who are not participants (read-only). */
  viewerCanPost: boolean;
}

/** VM-shaped action surface (the app layer adapts backend actions → these). */
export interface ChatActions {
  send: (input: {
    conversationId: string;
    body?: string;
    uploadRefs?: ChatAttachmentVM[];
  }) => Promise<{ ok: boolean; message?: ChatMessageVM; errorCode?: string }>;
  loadMore: (
    conversationId: string,
    cursor: string,
  ) => Promise<{ ok: boolean; messages: ChatMessageVM[]; nextCursor: string | null }>;
  listSince: (conversationId: string, afterIso: string) => Promise<ChatMessageVM[]>;
  markRead: (conversationId: string) => Promise<void>;
  translate: (messageId: string) => Promise<{ ok: boolean; text?: string }>;
  getUploadUrl: (input: {
    conversationId: string;
    filename: string;
    contentType: string;
  }) => Promise<{ ok: boolean; signedUrl?: string; path?: string }>;
  confirmAttachment: (input: {
    conversationId: string;
    path: string;
    name: string;
    mime: string;
    size: number;
  }) => Promise<{ ok: boolean; ref?: ChatAttachmentVM }>;
  getDownloadUrl: (input: {
    conversationId: string;
    path: string;
  }) => Promise<{ ok: boolean; url?: string }>;
}

/** Maps a raw `messages` row (snake_case, e.g. from a postgres_changes payload). */
export function mapMessageRow(row: Record<string, unknown>): ChatMessageVM {
  const att = Array.isArray(row.attachments) ? (row.attachments as ChatAttachmentVM[]) : [];
  const bt = row.body_translated as { lang?: string; text?: string } | null;
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    senderUserId: (row.sender_user_id as string | null) ?? null,
    kind: (row.kind as ChatMessageVM["kind"]) ?? "text",
    body: (row.body as string | null) ?? null,
    bodyTranslated: bt && typeof bt.text === "string" ? { lang: bt.lang ?? "en", text: bt.text } : null,
    attachments: att,
    createdAt: String(row.created_at),
  };
}
