/**
 * buildNotificationActions — adapts the raw notifications server actions (passed
 * by the app layer; NO @/backend import here) into VM-shaped NotificationActions.
 */

import { mapNotificationRow, type NotificationActions } from "./types";

type AR<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };
type Row = Record<string, unknown>;

export interface RawNotificationActions {
  list: (opts: { cursor?: string; limit?: number }) => Promise<AR<{ items: unknown[]; nextCursor: string | null }>>;
  markRead: (id: string) => Promise<AR<void>>;
  markAllRead: () => Promise<AR<void>>;
  getUnreadCount: () => Promise<AR<{ total: number }>>;
}

export function buildNotificationActions(
  raw: RawNotificationActions,
  locale: "es" | "en",
): NotificationActions {
  const mapPage = async (opts: { cursor?: string; limit?: number }) => {
    const r = await raw.list(opts);
    if (!r.success) return { items: [], nextCursor: null };
    return {
      items: r.data.items.map((row) => mapNotificationRow(row as Row, locale)),
      nextCursor: r.data.nextCursor,
    };
  };

  return {
    reload: () => mapPage({}),
    loadMore: (cursor: string) => mapPage({ cursor }),
    markRead: async (id: string) => { await raw.markRead(id); },
    markAllRead: async () => { await raw.markAllRead(); },
    getUnreadCount: async () => {
      const r = await raw.getUnreadCount();
      return r.success ? r.data.total : 0;
    },
  };
}
