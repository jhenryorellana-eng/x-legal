"use client";

/**
 * Registers the Web Push service worker (/sw.js) on the client surface (DOC-24).
 * Silent + idempotent — registration alone does not subscribe or prompt; the
 * subscription toggle (which requests permission) lives in the preferences UI.
 */

import * as React from "react";
import { ensureServiceWorker } from "@/frontend/features/notifications/push-helpers";

export function PushSwRegister() {
  React.useEffect(() => {
    void ensureServiceWorker();
  }, []);
  return null;
}
