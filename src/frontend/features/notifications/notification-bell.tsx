"use client";

/**
 * NotificationBell — staff topbar bell with a live unread badge + a popover
 * notification center. The NotificationCenter stays mounted (popover toggled via
 * visibility) so its realtime subscription keeps the badge live while closed.
 *
 * Styling lives in design-system/notifications.css (inline styles can't be
 * reached by media queries): desktop = 380px anchored popover; staff mobile
 * mode (≤860px) = full-screen surface with a visible close button.
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
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  const close = React.useCallback(() => setOpen(false), []);

  // Close on outside click (desktop pattern; harmless in full-screen mode
  // because the popover covers the whole viewport).
  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Close on Escape; return focus to the bell button on close.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
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
        className="bell-popover"
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <NotificationCenter
          userId={userId}
          locale={locale}
          initial={initial}
          initialCursor={initialCursor}
          actions={actions}
          onUnreadChange={setUnread}
          variant="popover"
          headerAction={
            <button
              type="button"
              className="bell-close"
              aria-label={locale === "es" ? "Cerrar avisos" : "Close notifications"}
              onClick={close}
            >
              <Icon name="x" size={20} color="currentColor" />
            </button>
          }
        />
      </div>
    </div>
  );
}
