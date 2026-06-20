/**
 * Notifications view-model (frontend). NO @/backend imports — data flows via VM.
 */

export interface NotificationVM {
  id: string;
  type: string;
  title: string;
  body: string | null;
  icon: string;
  color: string;
  actionUrl: string | null;
  read: boolean;
  createdAt: string;
}

type Row = Record<string, unknown>;

function pick(map: unknown, locale: string): string {
  const r = map as Record<string, string> | null;
  return r?.[locale] ?? r?.["es"] ?? "";
}

/** Maps a raw `notifications` row (snake_case, REST or postgres_changes) → VM. */
export function mapNotificationRow(row: Row, locale: "es" | "en"): NotificationVM {
  return {
    id: String(row.id),
    type: String(row.type ?? ""),
    title: pick(row.title_i18n, locale) || String(row.type ?? ""),
    body: pick(row.body_i18n, locale) || null,
    icon: (row.icon as string) ?? "bell",
    color: (row.color as string) ?? "accent",
    actionUrl: (row.action_url as string | null) ?? null,
    read: row.read_at != null,
    createdAt: String(row.created_at ?? ""),
  };
}

/** VM-shaped action surface (the app layer adapts backend actions → these). */
export interface NotificationActions {
  /** Fetches the first (newest) page fresh — used by the degraded poll tick. */
  reload: () => Promise<{ items: NotificationVM[]; nextCursor: string | null }>;
  loadMore: (cursor: string) => Promise<{ items: NotificationVM[]; nextCursor: string | null }>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  getUnreadCount: () => Promise<number>;
}
