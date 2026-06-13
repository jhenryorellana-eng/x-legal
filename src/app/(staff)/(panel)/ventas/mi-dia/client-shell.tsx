"use client";

/**
 * Mi día client shell — wraps the view with the Lex prefs provider so the
 * proactive bubbles + dock honor the config toggle. The dock greeting is passed
 * by the page; navigation handlers in the view are wired here via next/router.
 */

import * as React from "react";
import { LexPrefsProvider } from "@/frontend/features/vanessa";

export function MiDiaClientShell({ children }: { children: React.ReactNode }) {
  return <LexPrefsProvider>{children}</LexPrefsProvider>;
}
