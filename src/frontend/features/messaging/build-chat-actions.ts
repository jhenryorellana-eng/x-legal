/**
 * buildChatActions — adapts the raw messaging server actions (passed in by the
 * app layer; NO @/backend import here) into VM-shaped ChatActions + a thread loader.
 *
 * The app page imports the "use server" actions and calls this, keeping the
 * frontend free of backend imports (boundaries).
 */

import { mapMessageRow, type ChatActions, type ChatThreadVM, type ParticipantVM } from "./types";

type AR<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };
type Row = Record<string, unknown>;

export interface RawChatActions {
  getCaseThread: (caseId: string) => Promise<
    AR<{
      conversation: { id: string; scope: string; caseId: string | null; title: string | null };
      meUserId: string;
      messages: unknown[];
      nextCursor: string | null;
      myLastReadAt: string | null;
      participantIds: string[];
      participants?: ParticipantVM[];
      viewerCanPost: boolean;
    }>
  >;
  send: (input: {
    conversationId: string;
    body?: string;
    uploadRefs?: { path: string; name: string; mime: string; size: number }[];
  }) => Promise<AR<unknown>>;
  loadMore: (conversationId: string, cursor: string) => Promise<AR<{ messages: unknown[]; nextCursor: string | null }>>;
  listSince: (conversationId: string, afterIso: string) => Promise<AR<unknown[]>>;
  markRead: (conversationId: string) => Promise<AR<void>>;
  translate: (messageId: string) => Promise<AR<{ lang: "en" | "es"; text: string }>>;
  getUploadUrl: (input: { conversationId: string; filename: string; contentType: string }) => Promise<
    AR<{ signedUrl: string; path: string }>
  >;
  confirmAttachment: (input: {
    conversationId: string;
    path: string;
    name: string;
    mime: string;
    size: number;
  }) => Promise<AR<{ path: string; name: string; mime: string; size: number }>>;
  getDownloadUrl: (input: { conversationId: string; path: string }) => Promise<AR<{ url: string }>>;
}

export function buildChatActions(
  raw: RawChatActions,
  caseId: string,
): { loadThread: () => Promise<ChatThreadVM | null>; actions: ChatActions } {
  const loadThread = async (): Promise<ChatThreadVM | null> => {
    const r = await raw.getCaseThread(caseId);
    if (!r.success) return null;
    const d = r.data;
    return {
      conversationId: d.conversation.id,
      scope: d.conversation.scope,
      meUserId: d.meUserId,
      messages: d.messages.map((m) => mapMessageRow(m as Row)),
      nextCursor: d.nextCursor,
      myLastReadAt: d.myLastReadAt,
      participantIds: d.participantIds,
      participants: d.participants ?? [],
      viewerCanPost: d.viewerCanPost,
    };
  };

  const actions: ChatActions = {
    send: async (input) => {
      const r = await raw.send(input);
      return r.success ? { ok: true, message: mapMessageRow(r.data as Row) } : { ok: false, errorCode: r.error.code };
    },
    loadMore: async (conversationId, cursor) => {
      const r = await raw.loadMore(conversationId, cursor);
      return r.success
        ? { ok: true, messages: r.data.messages.map((m) => mapMessageRow(m as Row)), nextCursor: r.data.nextCursor }
        : { ok: false, messages: [], nextCursor: null };
    },
    listSince: async (conversationId, afterIso) => {
      const r = await raw.listSince(conversationId, afterIso);
      return r.success ? r.data.map((m) => mapMessageRow(m as Row)) : [];
    },
    markRead: async (conversationId) => {
      await raw.markRead(conversationId);
    },
    translate: async (messageId) => {
      const r = await raw.translate(messageId);
      return r.success ? { ok: true, text: r.data.text } : { ok: false };
    },
    getUploadUrl: async (input) => {
      const r = await raw.getUploadUrl(input);
      return r.success ? { ok: true, signedUrl: r.data.signedUrl, path: r.data.path } : { ok: false };
    },
    confirmAttachment: async (input) => {
      const r = await raw.confirmAttachment(input);
      return r.success ? { ok: true, ref: r.data } : { ok: false };
    },
    getDownloadUrl: async (input) => {
      const r = await raw.getDownloadUrl(input);
      return r.success ? { ok: true, url: r.data.url } : { ok: false };
    },
  };

  return { loadThread, actions };
}
