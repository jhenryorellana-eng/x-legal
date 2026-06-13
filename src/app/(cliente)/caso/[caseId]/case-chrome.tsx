"use client";

import * as React from "react";
import {
  BottomNav,
  MessagingLauncher,
  type BottomNavLabels,
} from "@/frontend/components/mobile";

/**
 * CaseChrome — client wrapper for the case-level chrome (DOC-51 §0.1).
 * Renders the CASO bottom nav (variant "caso") and the "Tu equipo" messaging
 * launcher with a case-context chip. Labels are resolved server-side and passed
 * as props (inject pattern, DOC-50 §2).
 *
 * The messaging sheet (overlay O1) arrives in a later wave; for now the launcher
 * is wired to open it via the `onOpenMessaging` callback if provided.
 */

export interface CaseChromeProps {
  caseId: string;
  navLabels: BottomNavLabels;
  teamLabel: string;
  unreadCount?: number;
}

export function CaseChrome({
  caseId,
  navLabels,
  teamLabel,
  unreadCount = 0,
}: CaseChromeProps) {
  return (
    <>
      <MessagingLauncher
        label={teamLabel}
        badge={unreadCount}
        absolute
        // TODO(F2-W?): open the messaging sheet (overlay O1) once built.
        onClick={() => {}}
      />
      <BottomNav
        variant="caso"
        caseId={caseId}
        labels={navLabels}
        absolute
      />
    </>
  );
}
