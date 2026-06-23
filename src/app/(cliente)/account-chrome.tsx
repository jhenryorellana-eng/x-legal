"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import {
  BottomNav,
  BottomSheet,
  MessagingLauncher,
  type BottomNavLabels,
} from "@/frontend/components/mobile";
import { ChatSheet } from "@/frontend/features/messaging/chat-sheet";
import {
  ClientCaseChatList,
  type ClientCaseChatVM,
} from "@/frontend/features/messaging/client-case-list";
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
  listClientCaseChatsAction,
} from "@/backend/modules/messaging/actions";
import { PwaInstallPrompt } from "./pwa-install-prompt";

/**
 * AccountChrome — client CUENTA chrome (AccountNav + "Tu equipo" launcher),
 * shown ONLY on account routes (DOC-51 §0.1).
 *
 * Messaging is now **one chat per case** (concordant with the staff panel):
 * at the account level the launcher opens a LIST of the client's case chats;
 * selecting one opens that case's thread (with a back arrow to the list). Inside
 * a case (`/caso/[caseId]`), `CaseChrome` opens that case's chat directly. The
 * `caseId` prop is only a "has ≥1 case" signal (gates the launcher); the list is
 * loaded lazily client-side.
 */

const ACCOUNT_PREFIXES = ["/home", "/servicios", "/comunidad", "/avisos", "/pagos", "/config"];

function isAccountRoute(pathname: string): boolean {
  return ACCOUNT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Static raw messaging actions (stable server-action references). */
const RAW = {
  getCaseThread: getCaseThreadAction,
  send: sendMessageAction,
  loadMore: loadMoreMessagesAction,
  listSince: listSinceAction,
  markRead: markReadAction,
  translate: translateMessageAction,
  getUploadUrl: getAttachmentUploadUrlAction,
  confirmAttachment: confirmAttachmentAction,
  getDownloadUrl: getAttachmentDownloadUrlAction,
};

export interface AccountChromeProps {
  navLabels: BottomNavLabels;
  teamLabel: string;
  unreadCount?: number;
  /** Truthy when the client has ≥1 case — gates the launcher. */
  caseId?: string | null;
}

export function AccountChrome({ navLabels, teamLabel, unreadCount = 0, caseId }: AccountChromeProps) {
  const pathname = usePathname() ?? "";
  const locale = (useLocale() === "en" ? "en" : "es") as "es" | "en";
  const tt = (es: string, en: string) => (locale === "es" ? es : en);

  const [view, setView] = React.useState<"closed" | "list" | "thread">("closed");
  const [selected, setSelected] = React.useState<{ caseId: string; serviceName: string } | null>(null);
  const [chats, setChats] = React.useState<ClientCaseChatVM[] | null>(null);
  const [loadingChats, setLoadingChats] = React.useState(false);

  const hasCases = !!caseId;
  const onAccount = isAccountRoute(pathname);

  // Lazily load (and reload) the case-chat list whenever the list view opens.
  // NOTE: `loadingChats` is intentionally NOT a dependency — it's set *inside*
  // this effect, so depending on it would make `setLoadingChats(true)` re-run
  // the effect and fire its own cleanup, cancelling the in-flight request and
  // leaving the list stuck on "Cargando…" forever.
  React.useEffect(() => {
    if (view !== "list" || chats !== null) return;
    let cancelled = false;
    setLoadingChats(true);
    listClientCaseChatsAction()
      .then((r) => {
        if (cancelled) return;
        setChats(r.success ? r.data : []);
      })
      .catch(() => {
        if (cancelled) return;
        setChats([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingChats(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, chats]);

  // In-screen "ask your team" affordances open the list. Reset on leaving.
  React.useEffect(() => {
    if (!onAccount) {
      setView("closed");
      return;
    }
    return onOpenTeamChat(() => setView("list"));
  }, [onAccount]);

  // Chat actions for the selected case (keyed by caseId via the ChatSheet key).
  const chat = React.useMemo(
    () => (selected ? buildChatActions(RAW, selected.caseId) : null),
    [selected],
  );

  if (!onAccount) return null;

  return (
    <>
      {hasCases ? (
        <MessagingLauncher label={teamLabel} badge={unreadCount} onClick={() => setView("list")} />
      ) : null}
      <BottomNav variant="cuenta" labels={navLabels} notifCount={unreadCount} />
      <PwaInstallPrompt />

      {/* Account-level list: one chat per case */}
      {hasCases ? (
        <BottomSheet
          open={view === "list"}
          onClose={() => setView("closed")}
          title={teamLabel}
          subtitle={tt("Tus chats, uno por caso", "Your chats, one per case")}
          height="82vh"
        >
          <ClientCaseChatList
            chats={chats ?? []}
            loading={loadingChats || chats === null}
            locale={locale}
            onSelect={(c) => {
              setSelected({ caseId: c.caseId, serviceName: c.serviceName ?? teamLabel });
              setView("thread");
            }}
          />
        </BottomSheet>
      ) : null}

      {/* Selected case thread (remounts per case so it reloads cleanly) */}
      {chat && selected ? (
        <ChatSheet
          key={selected.caseId}
          open={view === "thread"}
          onClose={() => setView("closed")}
          onBack={() => {
            setChats(null); // refresh unread/snippets on return
            setView("list");
          }}
          title={selected.serviceName}
          locale={locale}
          loadThread={chat.loadThread}
          actions={chat.actions}
        />
      ) : null}
    </>
  );
}
