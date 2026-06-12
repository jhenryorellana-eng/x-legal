"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";
import { ThemeToggle } from "@/frontend/components/brand/theme-toggle";

/**
 * Topbar — staff shell header (DOC-53 §0.3).
 *
 * Global search (⌘K, visual placeholder in F1-W1 — the command palette lands
 * with RF-TRX-035), theme toggle, notifications bell, and a user chip with a
 * logout control. The search is a button styled like an input so there is no
 * disabled <input> dissonance until the palette exists.
 */

export interface TopbarMessages {
  searchPlaceholder: string;
  notificationsLabel: string;
  logout: string;
  userName: string;
  userRole: string;
}

export interface TopbarProps {
  messages: TopbarMessages;
  /** Bound logout server action. */
  onLogout: () => void;
}

export function Topbar({ messages, onLogout }: TopbarProps) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 14,
        height: 64,
        padding: "0 22px",
        background: "color-mix(in srgb, var(--bg) 80%, transparent)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {/* Global search (button styled as input — ⌘K palette lands later) */}
      <button
        type="button"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flex: 1,
          maxWidth: 460,
          height: 42,
          padding: "0 14px",
          borderRadius: 999,
          border: "1px solid var(--line)",
          background: "var(--panel, var(--card))",
          color: "var(--ink-3)",
          cursor: "pointer",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          textAlign: "left",
        }}
      >
        <Icon name="search" size={18} color="var(--ink-3)" />
        <span
          style={{
            flex: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {messages.searchPlaceholder}
        </span>
        <kbd
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 1,
            padding: "2px 7px",
            borderRadius: 7,
            background: "var(--chip)",
            color: "var(--ink-2)",
            fontFamily: "var(--font-title)",
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          ⌘K
        </kbd>
      </button>

      <div style={{ flex: 1 }} />

      <ThemeToggle />

      {/* Notifications */}
      <button
        type="button"
        aria-label={messages.notificationsLabel}
        style={{
          position: "relative",
          display: "inline-grid",
          placeItems: "center",
          width: 40,
          height: 40,
          borderRadius: 999,
          border: "1px solid var(--line)",
          background: "var(--panel, var(--card))",
          color: "var(--ink-2)",
          cursor: "pointer",
        }}
      >
        <Icon name="bell" size={20} color="currentColor" />
      </button>

      {/* User chip + logout */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8,
          borderLeft: "1px solid var(--line)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            lineHeight: 1.15,
            marginRight: 6,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 13,
              color: "var(--ink)",
            }}
          >
            {messages.userName}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600 }}>
            {messages.userRole}
          </span>
        </div>
        <button
          type="button"
          onClick={onLogout}
          aria-label={messages.logout}
          title={messages.logout}
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 40,
            height: 40,
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--panel, var(--card))",
            color: "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          <Icon name="external" size={19} color="currentColor" />
        </button>
      </div>
    </header>
  );
}
