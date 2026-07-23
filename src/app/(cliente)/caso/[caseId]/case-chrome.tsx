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

/**
 * CaseChrome — client wrapper for the case-level chrome (DOC-51 §0.1).
 * Renders the CASO bottom nav and the "Tu equipo" messaging launcher, and opens
 * the chat overlay (O1, F7-Ola7a) on tap. Adapts the messaging server actions
 * into VM-shaped ChatActions for the shared ChatThread.
 */

const NO_CHROME_SUFFIXES = ["/disclaimer", "/subir", "/exito"];

export interface CaseChromeProps {
  caseId: string;
  navLabels: BottomNavLabels;
  teamLabel: string;
  unreadCount?: number;
  /** External-tool services → minimal caso nav (Inicio · Más only). */
  minimalMode?: boolean;
}

export function CaseChrome({ caseId, navLabels, teamLabel, unreadCount = 0, minimalMode = false }: CaseChromeProps) {
  const pathname = usePathname() ?? "";
  const locale = (useLocale() === "en" ? "en" : "es") as "es" | "en";
  const [chatOpen, setChatOpen] = React.useState(false);

  const noChrome = NO_CHROME_SUFFIXES.some((s) => pathname.endsWith(s));

  const { loadThread, actions } = React.useMemo(
    () =>
      buildChatActions(
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
      ),
    [caseId],
  );

  // In-screen "ask your team" affordances (e.g. the correction screen) open this
  // same overlay via the team-chat bus.
  React.useEffect(() => onOpenTeamChat(() => setChatOpen(true)), []);

  if (noChrome) return null;

  return (
    <>
      <MessagingLauncher label={teamLabel} badge={unreadCount} onClick={() => setChatOpen(true)} />
      <BottomNav variant="caso" caseId={caseId} labels={navLabels} minimalMode={minimalMode} />
      <ChatSheet
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        title={teamLabel}
        locale={locale}
        loadThread={loadThread}
        actions={actions}
      />
    </>
  );
}
