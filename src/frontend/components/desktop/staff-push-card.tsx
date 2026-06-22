"use client";

/**
 * StaffPushCard — shared Web Push device opt-in for the staff panels (DOC-24 §2 /
 * DOC-47 §5.3). Token-styled so it renders correctly in any staff surface. The
 * register/remove server actions are injected by the page (boundary-clean: no
 * @/backend import here). Subscribing requests the browser permission and stores
 * the subscription so the staffer receives onboarding-flow push (e.g. Vanessa on
 * `case.created`/`contract.signed`, Andrium on `downpayment.confirmed`).
 */

import * as React from "react";
import { usePushNotifications } from "@/frontend/features/notifications/use-push-notifications";
import type { BrowserPushSubscription } from "@/frontend/features/notifications/push-helpers";

type AR = { success: true } | { success: false; error: { code: string; message: string } };

export interface StaffPushCardProps {
  vapidPublicKey: string | undefined;
  registerAction: (input: BrowserPushSubscription & { platform?: string }) => Promise<AR>;
  removeAction: (endpoint: string) => Promise<AR>;
  strings: {
    title: string;
    subtitle?: string;
    enable: string;
    disable: string;
    enabled: string;
    unsupported: string;
    denied: string;
  };
}

export function StaffPushCard({
  vapidPublicKey,
  registerAction,
  removeAction,
  strings,
}: StaffPushCardProps) {
  const push = usePushNotifications({ vapidPublicKey, registerAction, removeAction });

  const blocked = push.status === "unsupported" || push.status === "denied";
  const statusLine =
    push.status === "unsupported"
      ? strings.unsupported
      : push.status === "denied"
        ? strings.denied
        : push.subscribed
          ? strings.enabled
          : (strings.subtitle ?? "");

  return (
    <div
      style={{
        maxWidth: 760,
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 18,
        padding: "20px 22px",
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 15.5, color: "var(--ink)" }}>
          {strings.title}
        </div>
        {statusLine ? (
          <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2, fontWeight: 600 }}>
            {statusLine}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        disabled={push.busy || blocked}
        aria-pressed={push.subscribed}
        onClick={() => {
          if (push.busy || blocked) return;
          if (push.subscribed) void push.unsubscribe();
          else void push.subscribe();
        }}
        style={{
          flexShrink: 0,
          height: 40,
          padding: "0 18px",
          border: push.subscribed ? "1px solid var(--line)" : "none",
          borderRadius: 10,
          cursor: push.busy || blocked ? "default" : "pointer",
          opacity: blocked ? 0.5 : 1,
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 14,
          background: push.subscribed ? "transparent" : "var(--accent)",
          color: push.subscribed ? "var(--ink-2)" : "#fff",
          transition: "background .15s, color .15s",
        }}
      >
        {push.subscribed ? strings.disable : strings.enable}
      </button>
    </div>
  );
}
