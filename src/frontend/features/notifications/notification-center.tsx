"use client";

/**
 * NotificationCenter — shared notification list (client /avisos page + staff
 * bell popover). Realtime via useNotificationsRealtime (user:{id}); optimistic
 * markRead on tap + navigate to the deep link; markAll; load more; empty state.
 *
 * Boundaries: no @/backend imports. Data + actions flow via VM/NotificationActions.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/frontend/components/brand";
import { type IconName } from "@/frontend/components/brand/icon";
import { useNotificationsRealtime } from "./use-notifications-realtime";
import type { NotificationActions, NotificationVM } from "./types";

// Maps the matrix' semantic icon names (RF-TRX-022) → the brand Icon vocabulary.
const ICON_MAP: Record<string, IconName> = {
  "file-check": "doc",
  "check-circle": "check",
  "alert-circle": "info",
  "dollar-sign": "dollar",
  calendar: "calendar",
  "calendar-x": "calendar",
  "calendar-clock": "calendar",
  bell: "bell",
  "message-circle": "chat",
  "user-plus": "user",
};
function toIconName(stored: string): IconName {
  return ICON_MAP[stored] ?? "bell";
}

export interface NotificationCenterProps {
  userId: string;
  locale: "es" | "en";
  initial: NotificationVM[];
  initialCursor: string | null;
  actions: NotificationActions;
  /** Reports the live unread count to the host (badge). */
  onUnreadChange?: (unread: number) => void;
  variant?: "page" | "popover";
}

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

function fmtWhen(iso: string, locale: "es" | "en") {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return tt(locale, "ahora", "now");
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} h`;
    return d.toLocaleDateString(locale === "es" ? "es-US" : "en-US", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

function colorVar(color: string): string {
  switch (color) {
    case "green": return "#1f9d57";
    case "amber": case "gold": return "var(--gold-deep, #b8860b)";
    case "red": return "#d14343";
    default: return "var(--accent)";
  }
}

export function NotificationCenter({
  userId, locale, initial, initialCursor, actions, onUnreadChange, variant = "page",
}: NotificationCenterProps) {
  const router = useRouter();
  const [items, setItems] = React.useState<NotificationVM[]>(initial);
  const [cursor, setCursor] = React.useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const idsRef = React.useRef<Set<string>>(new Set(initial.map((n) => n.id)));

  const unread = items.filter((n) => !n.read).length;
  React.useEffect(() => { onUnreadChange?.(unread); }, [unread, onUnreadChange]);

  const prepend = React.useCallback((n: NotificationVM) => {
    if (idsRef.current.has(n.id)) return;
    idsRef.current.add(n.id);
    setItems((prev) => [n, ...prev]);
  }, []);

  const reload = React.useCallback(async () => {
    const res = await actions.reload();
    idsRef.current = new Set(res.items.map((n) => n.id));
    setItems(res.items);
    setCursor(res.nextCursor);
  }, [actions]);

  useNotificationsRealtime({
    userId,
    locale,
    onNew: prepend,
    onPollTick: () => { void reload(); },
  });

  async function handleClick(n: NotificationVM) {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      void actions.markRead(n.id);
    }
    if (n.actionUrl) router.push(n.actionUrl);
  }

  async function handleMarkAll() {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    await actions.markAllRead();
  }

  async function handleLoadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const res = await actions.loadMore(cursor);
    setLoadingMore(false);
    const fresh = res.items.filter((n) => !idsRef.current.has(n.id));
    fresh.forEach((n) => idsRef.current.add(n.id));
    setItems((prev) => [...prev, ...fresh]);
    setCursor(res.nextCursor);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: variant === "popover" ? "12px 14px 8px" : "0 0 10px" }}>
        <span style={{ fontFamily: "var(--font-title)", fontWeight: 800, fontSize: variant === "popover" ? 15 : 20, color: "var(--ink)" }}>
          {tt(locale, "Avisos", "Notifications")}
        </span>
        {items.some((n) => !n.read) && (
          <button type="button" onClick={handleMarkAll}
            style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 4 }}>
            {tt(locale, "Marcar todo como leído", "Mark all as read")}
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: variant === "popover" ? 420 : undefined }}>
        {items.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--ink-3)", fontSize: 13.5, padding: "32px 12px" }}>
            {tt(locale, "No tienes avisos por ahora.", "You have no notifications yet.")}
          </p>
        )}

        {items.map((n) => (
          <button key={n.id} type="button" onClick={() => handleClick(n)}
            style={{
              display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", width: "100%",
              padding: "11px 12px", borderRadius: 14, cursor: "pointer",
              border: "1px solid var(--line)",
              background: n.read ? "var(--card)" : "color-mix(in srgb, var(--accent) 7%, var(--card))",
            }}>
            <span style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: `color-mix(in srgb, ${colorVar(n.color)} 14%, transparent)` }}>
              <Icon name={toIconName(n.icon)} size={17} color={colorVar(n.color)} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: "var(--ink)" }}>{n.title}</span>
                {!n.read && <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--accent)", flexShrink: 0 }} />}
              </span>
              {n.body && <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.35 }}>{n.body}</span>}
              <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-3)", marginTop: 3 }}>{fmtWhen(n.createdAt, locale)}</span>
            </span>
          </button>
        ))}

        {cursor && (
          <button type="button" onClick={handleLoadMore} disabled={loadingMore}
            style={{ alignSelf: "center", background: "none", border: "none", color: "var(--accent)", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 10 }}>
            {loadingMore ? tt(locale, "Cargando…", "Loading…") : tt(locale, "Ver más", "Load more")}
          </button>
        )}
      </div>
    </div>
  );
}
