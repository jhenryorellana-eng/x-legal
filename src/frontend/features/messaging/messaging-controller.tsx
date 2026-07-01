"use client";

/**
 * MessagingController — a tiny client-side context that lets any staff surface
 * open the floating messaging panel (FAB) on a specific case's conversation.
 *
 * Mounted once in StaffShell so the case workspace's "Mensajes" button and the
 * StaffMessagingPanel (siblings under the shell) share it without prop drilling
 * or a global event bus. Pure React — no native browser APIs (RNF-036 safe).
 *
 * The `nonce` makes each request distinct so clicking the same case twice (after
 * closing the panel) re-triggers the open. Consumers outside a provider get
 * `null` and no-op.
 */

import * as React from "react";

export interface OpenChatRequest {
  caseId: string;
  /** Monotonic counter so repeated opens on the same case re-fire the effect. */
  nonce: number;
}

export interface MessagingControllerValue {
  request: OpenChatRequest | null;
  openCaseChat: (caseId: string) => void;
}

const MessagingControllerContext =
  React.createContext<MessagingControllerValue | null>(null);

export function MessagingControllerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [request, setRequest] = React.useState<OpenChatRequest | null>(null);

  const openCaseChat = React.useCallback((caseId: string) => {
    setRequest((prev) => ({ caseId, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  const value = React.useMemo(
    () => ({ request, openCaseChat }),
    [request, openCaseChat],
  );

  return (
    <MessagingControllerContext.Provider value={value}>
      {children}
    </MessagingControllerContext.Provider>
  );
}

/** Returns the controller, or `null` when rendered outside a provider (safe no-op). */
export function useMessagingController(): MessagingControllerValue | null {
  return React.useContext(MessagingControllerContext);
}
