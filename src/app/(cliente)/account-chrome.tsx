"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import {
  BottomNav,
  MessagingLauncher,
  type BottomNavLabels,
} from "@/frontend/components/mobile";
import { ChatSheet } from "@/frontend/features/messaging/chat-sheet";
import { buildChatActions } from "@/frontend/features/messaging/build-chat-actions";
import { onOpenTeamChat } from "@/frontend/features/messaging/team-chat-bus";
import {
  getCaseThreadAction,
  sendMessageAction,
  loadMoreMessagesAction,
  listSinceAction,
  markReadAction,
  translateMessageAction,
  getAttachmentUploadUrlAction,
  confirmAttachmentAction,
  getAttachmentDownloadUrlAction,
} from "@/backend/modules/messaging/actions";
import { PwaInstallPrompt } from "./pwa-install-prompt";

/**
 * AccountChrome — client wrapper that renders the CUENTA chrome
 * (AccountNav variant "cuenta" + "Tu equipo" launcher) ONLY on account-level
 * routes (DOC-51 §0.1).
 *
 * The "Tu equipo" launcher opens the team chat for the client's PRIMARY case
 * (the same overlay O1 the case shell uses) — `caseId` is resolved server-side
 * in the (cliente) layout. When the client has no case yet, the launcher is
 * hidden (there is no team to message).
 *
 *   - shown on: /home, /servicios, /servicios/[slug], /comunidad, /avisos,
 *               /pagos, /config
 *   - hidden on: /welcome, /email, /otp, /no-access (ACCESO) and /caso/*
 *     (the case shell renders its own CaseNav + launcher).
 */

const ACCOUNT_PREFIXES = [
  "/home",
  "/servicios",
  "/comunidad",
  "/avisos",
  "/pagos",
  "/config",
];

function isAccountRoute(pathname: string): boolean {
  return ACCOUNT_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export interface AccountChromeProps {
  navLabels: BottomNavLabels;
  teamLabel: string;
  unreadCount?: number;
  /** Primary active case id — wires the "Tu equipo" launcher to its team chat. */
  caseId?: string | null;
}

export function AccountChrome({
  navLabels,
  teamLabel,
  unreadCount = 0,
  caseId,
}: AccountChromeProps) {
  const pathname = usePathname() ?? "";
  const locale = (useLocale() === "en" ? "en" : "es") as "es" | "en";
  const [chatOpen, setChatOpen] = React.useState(false);

  // Adapt the messaging server actions into the shared ChatSheet's VM (only when
  // there is a primary case to chat about). Hook runs unconditionally.
  const chat = React.useMemo(
    () =>
      caseId
        ? buildChatActions(
            {
              getCaseThread: getCaseThreadAction,
              send: sendMessageAction,
              loadMore: loadMoreMessagesAction,
              listSince: listSinceAction,
              markRead: markReadAction,
              translate: translateMessageAction,
              getUploadUrl: getAttachmentUploadUrlAction,
              confirmAttachment: confirmAttachmentAction,
              getDownloadUrl: getAttachmentDownloadUrlAction,
            },
            caseId,
          )
        : null,
    [caseId],
  );

  // In-screen "ask your team" affordances (e.g. service detail) open this same
  // overlay via the team-chat bus — but only while we're on an account route, so
  // a request fired elsewhere can't leave the sheet stuck open on return.
  const onAccount = isAccountRoute(pathname);
  React.useEffect(() => {
    if (!onAccount) {
      setChatOpen(false);
      return;
    }
    return onOpenTeamChat(() => setChatOpen(true));
  }, [onAccount]);

  if (!onAccount) return null;

  return (
    <>
      {chat ? (
        <MessagingLauncher
          label={teamLabel}
          badge={unreadCount}
          onClick={() => setChatOpen(true)}
        />
      ) : null}
      <BottomNav
        variant="cuenta"
        labels={navLabels}
        notifCount={unreadCount}
      />
      <PwaInstallPrompt />
      {chat ? (
        <ChatSheet
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          title={teamLabel}
          locale={locale}
          loadThread={chat.loadThread}
          actions={chat.actions}
        />
      ) : null}
    </>
  );
}
