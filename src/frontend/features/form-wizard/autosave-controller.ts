/**
 * AutosaveController — the FormWizard autosave engine (DOC-50 §6.3, RFC-CLI-033).
 *
 * Framework-agnostic on purpose: it owns ALL mutable state and timers and exposes
 * imperative methods + a subscription, so the React hook is thin glue and the
 * robustness rules are unit-testable in the node env (no DOM, no IndexedDB).
 *
 * Durability model (gap 1/2): the OUTBOX (answers not yet acknowledged by the
 * server) is written to the DraftStore on EVERY change (throttled), not only on
 * failure. So if the app is frozen/killed, the last on-device write already
 * landed ~writeAheadMs ago and nothing needs to complete at close time. The
 * database remains the source of truth (DOC-24 §2.4); the store is a transient
 * backup that only contributes edits that never reached BD.
 *
 * Error policy (gap 3): permanent rejections (form submitted elsewhere, stale
 * version, bad type) stop retrying and surface as "blocked" WITHOUT dropping the
 * outbox; transient ones retry with bounded backoff; offline waits for reconnect.
 */

import type { SaveDraftFn, SaveState } from "./types";
import type { DraftStore } from "./draft-store";
import { draftKey } from "./draft-store";
import { classifySaveError, type SaveErrorClass } from "./classify-save-error";

export interface AutosaveTiming {
  /** Idle window after the last keystroke before a network save (RFC-CLI-033). */
  debounceMs: number;
  /** Throttle for the durable on-device write-ahead. */
  writeAheadMs: number;
  /** Backoff schedule for transient retries (held at the last value). */
  backoffMs: readonly number[];
  /** How long the "saved ✓" indicator lingers before fading to idle. */
  savedFadeMs: number;
  /** Upper bound on transient retries while online (prevents infinite loops). */
  maxTransientAttempts: number;
}

export const DEFAULT_AUTOSAVE_TIMING: AutosaveTiming = {
  debounceMs: 1500,
  writeAheadMs: 300,
  backoffMs: [2000, 5000, 15000],
  savedFadeMs: 2200,
  maxTransientAttempts: 6,
};

export interface AutosaveControllerDeps {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  saveDraft: SaveDraftFn;
  store: DraftStore;
  /** Called whenever the public snapshot changes (drives useSyncExternalStore). */
  onChange: () => void;
  config?: Partial<AutosaveTiming>;
  classify?: (code: string | undefined) => SaveErrorClass;
  initialOnline?: boolean;
}

export interface AutosaveSnapshot {
  saveState: SaveState;
  online: boolean;
  responseId: string | null;
  /** The permanent-error code when saveState === "blocked" (for the message). */
  blockedCode: string | null;
}

export interface AutosaveController {
  /** Mark answers dirty and schedule a debounced save (drops `undefined` keys). */
  scheduleSave(patch: Record<string, unknown>): void;
  /** Persist now + save now if online (blur / step change / tab visible). */
  flush(): void;
  /** Persist the outbox now WITHOUT a network call (pagehide / hidden / unmount). */
  forceWriteAhead(): void;
  /**
   * Load a previous outbox from the store and resync it if online (on mount).
   * Returns the recovered answers so the UI can merge them over the server values
   * (an offline reload then shows the user's unsynced edits), or null if none.
   */
  hydrate(): Promise<Record<string, unknown> | null>;
  setOnline(online: boolean): void;
  getSnapshot(): AutosaveSnapshot;
  dispose(): void;
}

export function createAutosaveController(deps: AutosaveControllerDeps): AutosaveController {
  const { caseId, formDefinitionId, partyId, saveDraft, store, onChange } = deps;
  const timing: AutosaveTiming = { ...DEFAULT_AUTOSAVE_TIMING, ...deps.config };
  const classify = deps.classify ?? classifySaveError;
  const key = draftKey(caseId, formDefinitionId, partyId);

  // --- engine state ---
  let outbox: Record<string, unknown> = {};
  let saveState: SaveState = "idle";
  let responseId: string | null = null;
  let online = deps.initialOnline ?? true;
  let blockedCode: string | null = null;
  let attempt = 0;
  let inFlight = false;
  let disposed = false;

  // --- timers ---
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let writeAheadTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;

  // Cached snapshot — same reference until something changes (stable for React).
  let snapshot: AutosaveSnapshot = { saveState, online, responseId, blockedCode };

  function emit(): void {
    if (
      snapshot.saveState === saveState &&
      snapshot.online === online &&
      snapshot.responseId === responseId &&
      snapshot.blockedCode === blockedCode
    ) {
      return;
    }
    snapshot = { saveState, online, responseId, blockedCode };
    onChange();
  }

  function setState(next: SaveState): void {
    saveState = next;
    emit();
  }

  function cancel(timer: ReturnType<typeof setTimeout> | null): null {
    if (timer) clearTimeout(timer);
    return null;
  }

  function persistOutbox(): void {
    // Fire-and-forget; the store impls never throw (purge/unavailable degrades).
    if (Object.keys(outbox).length === 0) {
      void store.clear(key);
    } else {
      void store.write({
        key,
        caseId,
        formDefinitionId,
        partyId,
        answers: { ...outbox },
        updatedAt: Date.now(),
      });
    }
  }

  function scheduleWriteAhead(): void {
    if (writeAheadTimer) return; // already armed within the window
    writeAheadTimer = setTimeout(() => {
      writeAheadTimer = null;
      persistOutbox();
    }, timing.writeAheadMs);
  }

  function forceWriteAhead(): void {
    writeAheadTimer = cancel(writeAheadTimer);
    persistOutbox();
  }

  function scheduleSave(patch: Record<string, unknown>): void {
    if (disposed) return;
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue; // not serializable across the Server Action
      outbox[k] = v;
      changed = true;
    }
    if (!changed) return;

    scheduleWriteAhead();
    // Once blocked, stay blocked (reload required) — but keep backing up edits.
    if (saveState !== "blocked") setState(online ? "saving" : "queued");

    debounceTimer = cancel(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void doSave();
    }, timing.debounceMs);
  }

  function flush(): void {
    if (disposed) return;
    debounceTimer = cancel(debounceTimer);
    forceWriteAhead();
    if (online) void doSave();
  }

  async function doSave(): Promise<void> {
    if (disposed || inFlight || saveState === "blocked") return;
    if (!online) {
      if (Object.keys(outbox).length > 0) setState("queued");
      return;
    }
    const sent = { ...outbox };
    if (Object.keys(sent).length === 0) return;

    inFlight = true;
    setState("saving");
    try {
      const res = await saveDraft({ caseId, formDefinitionId, partyId, patch: sent });
      inFlight = false;
      if (disposed) return;

      if (res.ok) {
        attempt = 0;
        if (res.responseId) responseId = res.responseId;
        // Trim only keys still equal to what we sent — a value re-typed mid-flight
        // (different now) stays in the outbox and is re-sent (no lost keystroke).
        for (const [k, v] of Object.entries(sent)) {
          if (Object.is(outbox[k], v)) delete outbox[k];
        }
        persistOutbox();
        if (Object.keys(outbox).length > 0) {
          setState("saving");
          void doSave(); // more edits arrived during the request
        } else {
          setState("saved");
          fadeTimer = cancel(fadeTimer);
          fadeTimer = setTimeout(() => {
            fadeTimer = null;
            if (saveState === "saved") setState("idle");
          }, timing.savedFadeMs);
        }
        return;
      }

      // Logical rejection from the server.
      persistOutbox(); // keep the data locally regardless of the verdict
      const verdict: SaveErrorClass =
        res.retryable === true
          ? "transient"
          : res.retryable === false
            ? "permanent"
            : classify(res.error?.code);
      if (verdict === "permanent") {
        blockedCode = res.error?.code ?? null;
        setState("blocked");
      } else {
        setState("error");
        scheduleRetry();
      }
    } catch {
      // Thrown = network / server unreachable. Data is safe on-device; resync later.
      inFlight = false;
      if (disposed) return;
      persistOutbox();
      setState("queued");
      if (online) scheduleRetry(); // bounded; offline relies on the online event
    }
  }

  function scheduleRetry(): void {
    if (attempt >= timing.maxTransientAttempts) return; // bounded — no infinite loop
    retryTimer = cancel(retryTimer);
    const delay = timing.backoffMs[Math.min(attempt, timing.backoffMs.length - 1)];
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void doSave();
    }, delay);
  }

  function setOnline(next: boolean): void {
    if (online === next) return;
    online = next;
    emit();
    if (next) {
      attempt = 0;
      retryTimer = cancel(retryTimer);
      void doSave(); // resync whatever is queued
    }
  }

  async function hydrate(): Promise<Record<string, unknown> | null> {
    if (disposed) return null;
    const rec = await store.read(key);
    if (disposed || !rec || Object.keys(rec.answers).length === 0) return null;
    // Stored edits sit UNDER any in-memory edits (in-memory is fresher).
    outbox = { ...rec.answers, ...outbox };
    if (saveState !== "blocked") setState(online ? "saving" : "queued");
    if (online) void doSave();
    return { ...rec.answers };
  }

  function dispose(): void {
    disposed = true;
    debounceTimer = cancel(debounceTimer);
    writeAheadTimer = cancel(writeAheadTimer);
    retryTimer = cancel(retryTimer);
    fadeTimer = cancel(fadeTimer);
  }

  return {
    scheduleSave,
    flush,
    forceWriteAhead,
    hydrate,
    setOnline,
    getSnapshot: () => snapshot,
    dispose,
  };
}
