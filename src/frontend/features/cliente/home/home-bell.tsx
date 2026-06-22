"use client";

/**
 * HomeBell — live bell badge for the client dashboard (`/home`).
 *
 * The dashboard is a Server Component, so its unread count is baked into the
 * HTML at request time and never moves until a full refresh. This tiny client
 * island re-mounts the bell as a Link (→ /avisos) whose badge is driven by
 * `useNotificationsRealtime`: +1 on every `notifications` INSERT for this user
 * (realtime confirmed working — private `user:{id}` channel + postgres_changes),
 * with a 60 s poll re-sync (via the injected `refetchUnread` action) when the
 * realtime channel degrades. Mirrors the staff NotificationBell pattern.
 *
 * Boundary note (frontend → frontend | shared): the server action is injected as
 * a prop by the app layer (page.tsx) — this feature never imports `@/backend`.
 */

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/frontend/components/brand/icon";
import { useNotificationsRealtime } from "@/frontend/features/notifications/use-notifications-realtime";

/** Structural shape of `getUnreadCountAction`'s result (ActionResult lives in backend). */
export type RefetchUnread = () => Promise<{
  success: boolean;
  data?: { total: number };
}>;

export interface HomeBellProps {
  userId: string;
  locale: "es" | "en";
  initialUnread: number;
  ariaLabel: string;
  refetchUnread: RefetchUnread;
}

export function HomeBell({
  userId,
  locale,
  initialUnread,
  ariaLabel,
  refetchUnread,
}: HomeBellProps) {
  const [unread, setUnread] = React.useState(initialUnread);

  useNotificationsRealtime({
    userId,
    locale,
    onNew: () => setUnread((u) => u + 1),
    onPollTick: () => {
      void refetchUnread()
        .then((res) => {
          if (res.success && res.data) setUnread(res.data.total);
        })
        .catch(() => {});
    },
  });

  return (
    <Link
      href="/avisos"
      aria-label={ariaLabel}
      className="mp-pop"
      style={{
        position: "relative",
        width: 48,
        height: 48,
        borderRadius: 999,
        background: "var(--card)",
        boxShadow: "var(--shadow-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <Icon name="bell" size={24} color="var(--navy)" />
      {unread > 0 && (
        <span
          style={{
            position: "absolute",
            top: 6,
            right: 7,
            minWidth: 18,
            height: 18,
            padding: "0 4px",
            borderRadius: 999,
            background: "var(--red)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 0 2px var(--card)",
          }}
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
