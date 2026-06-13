"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
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
 * NO_CHROME screens (disclaimer / subir / exito — DOC-51 §0.1) hide the nav and
 * launcher; they are full-screen focused flows. We detect them by pathname.
 *
 * The messaging sheet (overlay O1) arrives in a later wave; for now the launcher
 * opens it via `onClick` (no-op placeholder).
 */

const NO_CHROME_SUFFIXES = ["/disclaimer", "/subir", "/exito"];

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
  const pathname = usePathname() ?? "";
  const noChrome = NO_CHROME_SUFFIXES.some((s) => pathname.endsWith(s));
  if (noChrome) return null;

  return (
    <>
      <MessagingLauncher
        label={teamLabel}
        badge={unreadCount}
        absolute
        // TODO(F2-W?): open the messaging sheet (overlay O1) once built.
        onClick={() => {}}
      />
      <BottomNav variant="caso" caseId={caseId} labels={navLabels} absolute />
    </>
  );
}
