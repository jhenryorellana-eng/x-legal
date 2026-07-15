"use client";

/**
 * LexBoardBubble — renders a composed `LexBubbleVM` on a staff board.
 *
 * Shared by all four home boards: honours the config toggle (`useLexPrefs`), and
 * wires each action's `onClick` — a custom handler by action id when provided
 * (e.g. "contactTopLead" on mi día), otherwise navigating to the action's deep
 * link. Renders nothing when there is no insight or bubbles are off.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { LexBubble } from "./lex";
import { useLexPrefs } from "../lex-prefs";
import type { LexBubbleVM } from "../types";

export function LexBoardBubble({
  vm,
  orb = 30,
  handlers,
}: {
  vm: LexBubbleVM | null;
  orb?: number;
  /** Custom onClick per action id; falls back to navigating to `href`. */
  handlers?: Record<string, () => void>;
}) {
  const router = useRouter();
  const { bubbles } = useLexPrefs();
  if (!vm) return null;

  return (
    <LexBubble
      dismissKey={vm.dismissKey}
      orb={orb}
      enabled={bubbles}
      html={vm.html}
      actions={vm.actions.map((a) => ({
        label: a.label,
        icon: a.icon,
        ghost: a.ghost,
        onClick:
          handlers?.[a.id] ??
          (() => {
            if (a.href) router.push(a.href);
          }),
      }))}
    />
  );
}
