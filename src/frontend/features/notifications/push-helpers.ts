"use client";

/**
 * Web Push browser helpers (DOC-24). The implementation moved to the
 * platform-bridge web impl (`@/frontend/platform-bridge/web`, Ola 8d) — feature
 * code now reaches Push through `getBridge().push`. This file remains as a thin
 * re-export so the app shell (`(cliente)/push-sw-register.tsx`) can keep
 * registering the service worker without importing the bridge internals.
 */

export {
  urlBase64ToUint8Array,
  pushSupport,
  ensureServiceWorker,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSupport,
  type BrowserPushSubscription,
} from "@/frontend/platform-bridge/web";
