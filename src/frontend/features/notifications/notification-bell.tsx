"use client";

/**
 * NotificationBell — staff topbar bell with a live unread badge + a popover
 * notification center. The NotificationCenter stays mounted (popover toggled via
 * visibility) so its realtime subscription keeps the badge live while closed.
 */

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";
import {
  buildNotificationActions,
  type RawNotificationActions,
} from "./build-notification-actions";
import { NotificationCenter } from "./notification-center";
import type { NotificationVM } from "./types";

export interface NotificationBellProps {
  userId: string;
  locale: "es" | "en";
  label: string;
  initial: NotificationVM[];
  initialCursor: string | null;
  initialUnread: number;
  raw: RawNotificationActions;
}

export function NotificationBell({
  userId, locale, label, initial, initialCursor, initialUnread, raw,
}: NotificationBellProps) {
  const [open, setOpen] = React.useState(false);
  const [unread, setUnread] = React.useState(initialUnread);
  const actions = React.useMemo(() => buildNotificationActions(raw, locale), [raw, locale]);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "relative", display: "inline-grid", placeItems: "center",
          width: 40, height: 40, borderRadius: 999,
          border: "1px solid var(--line)", background: "var(--panel, var(--card))",
          color: "var(--ink-2)", cursor: "pointer",
        }}
      >
        <Icon name="bell" size={20} color="currentColor" />
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, padding: "0 5px",
            display: "grid", placeItems: "center", borderRadius: 999,
            background: "var(--accent)", color: "#fff", fontSize: 10.5, fontWeight: 800,
            border: "2px solid var(--bg, #fff)",
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <div
        style={{
          position: "absolute", right: 0, top: 50, width: 380, maxWidth: "90vw", zIndex: 40,
          display: open ? "block" : "none",
          background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16,
          boxShadow: "0 18px 50px rgba(0,0,0,0.18)", padding: "4px 10px 12px",
        }}
      >
        <NotificationCenter
          userId={userId}
          locale={locale}
          initial={initial}
          initialCursor={initialCursor}
          actions={actions}
          onUnreadChange={setUnread}
          variant="popover"
        />
      </div>
    </div>
  );
}
