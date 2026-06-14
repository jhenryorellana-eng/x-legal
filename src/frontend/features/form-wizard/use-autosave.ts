"use client";

import * as React from "react";
import type { SaveDraftFn, SaveState } from "./types";
import {
  enqueueDraft,
  clearQueuedDraft,
  readQueuedDraft,
  backoffDelay,
} from "./autosave-queue";

/**
 * useAutosave — the FormWizard autosave engine (DOC-50 §6.3).
 *
 * Behaviour (vinculante):
 *  - Debounce 1.5s after the last keystroke.
 *  - Flush IMMEDIATELY on blur, step change and `visibilitychange` (hidden).
 *  - Sends a PARTIAL patch (only the dirty answers) via `saveDraft` (API-CASE-16).
 *  - Discreet indicator: "Guardando… / Guardado ✓" (never blocks typing).
 *  - On network failure: enqueue to IndexedDB + retry with backoff 2s→5s→15s;
 *    on reconnect (`online` event) flush the queue.
 *
 * The hook owns NO answer state — the wizard passes the latest answers via a ref
 * getter (`getDirtyPatch`) so a flush always sends the freshest values.
 */

const DEBOUNCE_MS = 1500;

export interface UseAutosaveArgs {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  saveDraft: SaveDraftFn;
  /** Returns the answers changed since the last successful save (and clears them on success). */
  enabled?: boolean;
}

export interface AutosaveApi {
  saveState: SaveState;
  /** Mark some answers dirty and schedule a debounced save. */
  scheduleSave: (patch: Record<string, unknown>) => void;
  /** Flush any pending dirty answers right now (blur / step change / unmount). */
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
}: UseAutosaveArgs): AutosaveApi {
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [responseId, setResponseId] = React.useState<string | null>(null);

  // Pending (un-sent) patch — merged across keystrokes.
  const pendingRef = React.useRef<Record<string, unknown>>({});
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = React.useRef(0);
  const inFlightRef = React.useRef(false);
  const savedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveDraftRef = React.useRef(saveDraft);
  saveDraftRef.current = saveDraft;

  // doSave is stable; reads pendingRef so it always sends the freshest patch.
  const doSave = React.useCallback(async () => {
    if (inFlightRef.current) return; // serialize — never overlap saves
    const patch = pendingRef.current;
    if (Object.keys(patch).length === 0) return;

    // Take a snapshot and optimistically clear pending; restore on failure.
    const snapshot = { ...patch };
    pendingRef.current = {};
    inFlightRef.current = true;
    setSaveState("saving");

    try {
      const res = await saveDraftRef.current({
        caseId,
        formDefinitionId,
        partyId,
        patch: snapshot,
      });
      inFlightRef.current = false;
      if (res.ok) {
        attemptRef.current = 0;
        if (res.responseId) setResponseId(res.responseId);
        await clearQueuedDraft(caseId, formDefinitionId, partyId);
        // If more keystrokes arrived during the request, keep saving; else "saved".
        if (Object.keys(pendingRef.current).length > 0) {
          void doSave();
        } else {
          setSaveState("saved");
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => {
            setSaveState((s) => (s === "saved" ? "idle" : s));
          }, 2200);
        }
      } else {
        // Server rejected (not a network error) — re-merge & queue; surface error.
        pendingRef.current = { ...snapshot, ...pendingRef.current };
        await enqueueDraft(caseId, formDefinitionId, partyId, pendingRef.current);
        setSaveState("error");
        scheduleRetry();
      }
    } catch {
      // Network failure / offline — re-merge the snapshot ahead of new edits.
      inFlightRef.current = false;
      pendingRef.current = { ...snapshot, ...pendingRef.current };
      await enqueueDraft(caseId, formDefinitionId, partyId, pendingRef.current);
      setSaveState("queued");
      scheduleRetry();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, formDefinitionId, partyId]);

  const scheduleRetry = React.useCallback(() => {
    if (retryRef.current) clearTimeout(retryRef.current);
    const delay = backoffDelay(attemptRef.current);
    attemptRef.current += 1;
    retryRef.current = setTimeout(() => {
      void doSave();
    }, delay);
  }, [doSave]);

  const flush = React.useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void doSave();
  }, [doSave]);

  const scheduleSave = React.useCallback(
    (patch: Record<string, unknown>) => {
      if (!enabled) return;
      pendingRef.current = { ...pendingRef.current, ...patch };
      setSaveState((s) => (s === "saved" || s === "idle" ? "saving" : s));
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void doSave();
      }, DEBOUNCE_MS);
    },
    [doSave, enabled],
  );

  // Flush on tab hide (visibilitychange) and on pagehide; retry on reconnect.
  React.useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onOnline = () => {
      attemptRef.current = 0;
      void doSave();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, flush, doSave]);

  // On mount: hydrate any queued (un-synced) draft from a previous offline session.
  React.useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      const queued = await readQueuedDraft(caseId, formDefinitionId, partyId);
      if (active && queued && Object.keys(queued.patch).length > 0) {
        pendingRef.current = { ...queued.patch, ...pendingRef.current };
        setSaveState("queued");
        if (navigator.onLine) void doSave();
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, formDefinitionId, partyId, enabled]);

  // Flush on unmount so navigating away never drops the last keystrokes.
  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      // best-effort final save (fire and forget)
      void doSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { saveState, scheduleSave, flush, responseId };
}
