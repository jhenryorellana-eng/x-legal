"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  BottomNav,
  MessagingLauncher,
  type BottomNavLabels,
} from "@/frontend/components/mobile";

/**
 * AccountChrome — client wrapper that renders the CUENTA chrome
 * (AccountNav variant "cuenta" + "Tu equipo" launcher) ONLY on account-level
 * routes (DOC-51 §0.1).
 *
 * The (cliente) route group also contains the ACCESO screens
 * (welcome/phone/otp/no-access) and the CASE shell — none of which show this
 * chrome. The prototype's `App` decides chrome from the screen table; here we
 * mirror that by matching the pathname:
 *   - shown on: /home, /servicios, /servicios/[slug], /comunidad, /avisos,
 *               /pagos, /config
 *   - hidden on: /welcome, /phone, /otp, /no-access (ACCESO) and /caso/*
 *     (the case shell renders its own CaseNav).
 *
 * Labels are resolved server-side and injected as props (DOC-50 §2).
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
}

export function AccountChrome({
  navLabels,
  teamLabel,
  unreadCount = 0,
}: AccountChromeProps) {
  const pathname = usePathname() ?? "";
  if (!isAccountRoute(pathname)) return null;

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
        variant="cuenta"
        labels={navLabels}
        notifCount={unreadCount}
        absolute
      />
    </>
  );
}
