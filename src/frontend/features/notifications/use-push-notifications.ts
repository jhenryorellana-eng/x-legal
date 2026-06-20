"use client";

/**
 * usePushNotifications — manages the browser Web Push subscription lifecycle and
 * syncs it with the server. Boundary-clean: the register/remove server actions
 * are injected by the app layer (no @/backend import here).
 *
 * Ola 8d: native Push access goes through the platform-bridge (`getBridge().push`)
 * instead of touching `navigator.serviceWorker` / `PushManager` directly, so a
 * future Capacitor build swaps the implementation without changing this hook.
 */

import * as React from "react";
import { getBridge, type PushSubscriptionInfo } from "@/frontend/platform-bridge";
import type { PushSupport, BrowserPushSubscription } from "./push-helpers";

type AR = { success: true } | { success: false; error: { code: string; message: string } };

export interface UsePushArgs {
  /** NEXT_PUBLIC_VAPID_PUBLIC_KEY, read in the app layer and passed down. */
  vapidPublicKey: string | undefined;
  registerAction: (input: BrowserPushSubscription & { platform?: string }) => Promise<AR>;
  removeAction: (endpoint: string) => Promise<AR>;
}

export interface UsePushResult {
  status: PushSupport;
  subscribed: boolean;
  busy: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

/** Maps the bridge permission status to the UI's PushSupport shape. */
async function readStatus(): Promise<PushSupport> {
  const push = getBridge().push;
  if (!(await push.isSupported())) return "unsupported";
  const perm = await push.getPermissionStatus();
  if (perm === "granted") return "granted";
  if (perm === "denied") return "denied";
  return "default";
}

export function usePushNotifications(args: UsePushArgs): UsePushResult {
  const [status, setStatus] = React.useState<PushSupport>("default");
  const [subscribed, setSubscribed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const argsRef = React.useRef(args);
  argsRef.current = args;

  // Reflect current permission + existing subscription on mount.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await readStatus();
      if (!cancelled) setStatus(s);
      const sub = await getBridge().push.getCurrentSubscription();
      if (!cancelled) setSubscribed(!!sub);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = React.useCallback(async () => {
    setBusy(true);
    try {
      const info: PushSubscriptionInfo | null =
        await getBridge().push.requestPermissionAndSubscribe();
      setStatus(await readStatus());
      if (!info) return;
      const res = await argsRef.current.registerAction({
        endpoint: info.endpoint,
        keys: info.keys,
        platform: info.platform,
      });
      if (res.success) setSubscribed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const unsubscribe = React.useCallback(async () => {
    setBusy(true);
    try {
      const current = await getBridge().push.getCurrentSubscription();
      await getBridge().push.unsubscribe();
      if (current?.endpoint) await argsRef.current.removeAction(current.endpoint);
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, subscribed, busy, subscribe, unsubscribe };
}
