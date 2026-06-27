"use client";

import * as React from "react";
import type { SaveDraftFn, SaveState } from "./types";
import {
  createAutosaveController,
  type AutosaveController,
  type AutosaveSnapshot,
} from "./autosave-controller";
import { createIndexedDbDraftStore } from "./draft-store";

/**
 * useAutosave — thin React glue around the framework-agnostic AutosaveController
 * (DOC-50 §6.3, RFC-CLI-033). All the autosave logic — debounce, durable
 * write-ahead, offline queue, error classification, retry — lives in the
 * controller (unit-tested in the node env). This hook only:
 *  - owns one controller + IndexedDB store per (case, form, party) instance,
 *  - bridges native events (visibility/pagehide/online/offline) to it,
 *  - exposes its snapshot to React via useSyncExternalStore,
 *  - hydrates a previous offline outbox on mount and forces a final durable
 *    write on unmount (navigating away never drops the last keystrokes).
 */

const SERVER_SNAPSHOT: AutosaveSnapshot = {
  saveState: "idle",
  online: true,
  responseId: null,
  blockedCode: null,
};

export interface UseAutosaveArgs {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  saveDraft: SaveDraftFn;
  enabled?: boolean;
  /** Called once on mount with any answers recovered from the offline outbox, so
   *  the wizard can merge them over the server values (offline-reload rehydration). */
  onHydrate?: (answers: Record<string, unknown>) => void;
}

export interface AutosaveApi {
  saveState: SaveState;
  /** Browser connectivity — drives the persistent offline banner. */
  online: boolean;
  /** Permanent-error code when saveState === "blocked" (for the specific message). */
  blockedCode: string | null;
  /** Mark some answers dirty and schedule a debounced save. */
  scheduleSave: (patch: Record<string, unknown>) => void;
  /** Flush any pending dirty answers right now (blur / step change). */
  flush: () => void;
  /** The responseId once the backend has created the draft row. */
  responseId: string | null;
}

export function useAutosave({
  caseId,
  formDefinitionId,
  partyId,
  saveDraft,
  enabled = true,
  onHydrate,
}: UseAutosaveArgs): AutosaveApi {
  // Keep the action + hydrate callback fresh without re-creating the controller.
  const saveDraftRef = React.useRef(saveDraft);
  saveDraftRef.current = saveDraft;
  const onHydrateRef = React.useRef(onHydrate);
  onHydrateRef.current = onHydrate;

  const listenersRef = React.useRef<Set<() => void>>(new Set());
  const controllerRef = React.useRef<AutosaveController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createAutosaveController({
      caseId,
      formDefinitionId,
      partyId,
      saveDraft: (input) => saveDraftRef.current(input),
      store: createIndexedDbDraftStore(),
      onChange: () => listenersRef.current.forEach((l) => l()),
      // initialOnline defaults true to match SSR; the mount effect corrects it.
    });
  }
  const controller = controllerRef.current;

  const subscribe = React.useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const snapshot = React.useSyncExternalStore(
    subscribe,
    () => controller.getSnapshot(),
    () => SERVER_SNAPSHOT,
  );

  // Mount: hydrate the offline outbox + wire native events. Re-runs if `enabled`
  // flips (e.g. the form becomes read-only after submit).
  React.useEffect(() => {
    if (!enabled) return;

    controller.setOnline(navigator.onLine);
    void controller.hydrate().then((recovered) => {
      if (recovered) onHydrateRef.current?.(recovered);
    });

    const onVisibility = () => {
      if (document.visibilityState === "hidden") controller.forceWriteAhead();
      else controller.flush(); // back in view → sync anything pending
    };
    const onPageHide = () => controller.forceWriteAhead();
    const onOnline = () => controller.setOnline(true);
    const onOffline = () => controller.setOnline(false);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [enabled, controller]);

  // Final durable write + teardown on unmount.
  React.useEffect(() => {
    return () => {
      controller.forceWriteAhead();
      controller.dispose();
    };
  }, [controller]);

  const scheduleSave = React.useCallback(
    (patch: Record<string, unknown>) => {
      if (enabled) controller.scheduleSave(patch);
    },
    [enabled, controller],
  );

  const flush = React.useCallback(() => {
    if (enabled) controller.flush();
  }, [enabled, controller]);

  return {
    saveState: snapshot.saveState,
    online: snapshot.online,
    blockedCode: snapshot.blockedCode,
    scheduleSave,
    flush,
    responseId: snapshot.responseId,
  };
}
