"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  type SidebarGroup,
  type SidebarUser,
} from "@/frontend/components/desktop/sidebar";
import { Topbar } from "@/frontend/components/desktop/topbar";
import {
  BrandToaster,
} from "@/frontend/components/desktop/toast";
import { Icon } from "@/frontend/components/brand/icon";
import { NotificationBell } from "@/frontend/features/notifications/notification-bell";
import type { NotificationVM } from "@/frontend/features/notifications/types";
import type { RawNotificationActions } from "@/frontend/features/notifications/build-notification-actions";

/**
 * StaffShell — the desktop panel chrome (DOC-50 §1.3, DOC-53 §0).
 *
 * Composes Sidebar (fixed 248px) + Topbar + content area + Toaster. Receives
 * the already permission-filtered nav, the resolved user chip data and the
 * resolved i18n strings as serializable props, plus the logout server action
 * injected from the server layout (DOC-50 §2 inject-actions pattern).
 *
 * Client because the active nav item depends on `usePathname` (Sidebar) and the
 * logout button is interactive; all data comes from the server layout as props.
 */

export interface StaffShellMessages {
  panelLabel: string;
  searchPlaceholder: string;
  notificationsLabel: string;
  logout: string;
}

export interface StaffShellNotifications {
  userId: string;
  locale: "es" | "en";
  initial: NotificationVM[];
  initialCursor: string | null;
  initialUnread: number;
  raw: RawNotificationActions;
}

export interface StaffShellProps {
  groups: SidebarGroup[];
  user: SidebarUser;
  messages: StaffShellMessages;
  /** Logout server action, injected from the layout. */
  logoutAction: () => void;
  /** Notification bell data + actions (injected from the layout). */
  notifications?: StaffShellNotifications;
  children: React.ReactNode;
}

export function StaffShell({
  groups,
  user,
  messages,
  logoutAction,
  notifications,
  children,
}: StaffShellProps) {
  const [pending, startTransition] = React.useTransition();
  const [navOpen, setNavOpen] = React.useState(false);
  const pathname = usePathname();

  // Close the mobile nav drawer whenever the route changes (link tapped).
  React.useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  function handleLogout() {
    startTransition(() => logoutAction());
  }

  return (
    <div style={{ display: "flex", minHeight: "100dvh" }}>
      {navOpen ? (
        <div
          className="staff-shell-scrim"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      ) : null}
      <Sidebar
        panelLabel={messages.panelLabel}
        groups={groups}
        user={user}
        open={navOpen}
        footerSlot={
          <button
            type="button"
            onClick={handleLogout}
            aria-label={messages.logout}
            title={messages.logout}
            disabled={pending}
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 34,
              height: 34,
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--panel-2, var(--card-alt))",
              color: "var(--ink-2)",
              cursor: pending ? "default" : "pointer",
              opacity: pending ? 0.6 : 1,
              flexShrink: 0,
            }}
          >
            <Icon name="external" size={17} color="currentColor" />
          </button>
        }
      />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-grad, var(--bg))",
        }}
      >
        <Topbar
          messages={{
            searchPlaceholder: messages.searchPlaceholder,
            notificationsLabel: messages.notificationsLabel,
            logout: messages.logout,
            userName: user.name,
            userRole: user.title,
          }}
          onLogout={handleLogout}
          onMenuClick={() => setNavOpen(true)}
          menuLabel={messages.panelLabel}
          bellSlot={
            notifications ? (
              <NotificationBell
                userId={notifications.userId}
                locale={notifications.locale}
                label={messages.notificationsLabel}
                initial={notifications.initial}
                initialCursor={notifications.initialCursor}
                initialUnread={notifications.initialUnread}
                raw={notifications.raw}
              />
            ) : undefined
          }
        />
        <main className="staff-shell-main" style={{ flex: 1, minWidth: 0 }}>
          {children}
        </main>
      </div>

      <BrandToaster />
    </div>
  );
}
