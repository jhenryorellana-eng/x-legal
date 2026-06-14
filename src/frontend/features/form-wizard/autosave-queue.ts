/**
 * IndexedDB draft queue for the FormWizard autosave (DOC-50 §6.3).
 *
 * When a `saveDraft` call fails (offline / network error), the patch is enqueued
 * locally here and retried with backoff (2s → 5s → 15s) and on reconnect. The
 * queue is feature-owned (NOT the service worker — DOC-24 §2.4). It is a cache,
 * not the source of truth (anti-pattern A4): the OS may purge it; BD wins.
 *
 * One queue row per (caseId, formDefinitionId, partyId). Patches MERGE — the
 * latest value per question wins (last-write-wins per field, never invented at
 * the field level beyond the merge order the user typed).
 */

const DB_NAME = "ulp-form-wizard";
const STORE = "drafts";
const DB_VERSION = 1;

export interface QueuedDraft {
  /** Composite key: `${caseId}:${formDefinitionId}:${partyId ?? "_"}`. */
  key: string;
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  /** Merged answers patch awaiting sync. */
  patch: Record<string, unknown>;
  updatedAt: number;
}

export function draftKey(caseId: string, formDefinitionId: string, partyId: string | null): string {
  return `${caseId}:${formDefinitionId}:${partyId ?? "_"}`;
}

function hasIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Merges a new patch into the queued draft for this form (creating the row if
 * absent). Resolves silently when IndexedDB is unavailable (private mode, etc.).
 */
export async function enqueueDraft(
  caseId: string,
  formDefinitionId: string,
  partyId: string | null,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDb();
    const key = draftKey(caseId, formDefinitionId, partyId);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const existing = getReq.result as QueuedDraft | undefined;
        const merged: QueuedDraft = {
          key,
          caseId,
          formDefinitionId,
          partyId,
          patch: { ...(existing?.patch ?? {}), ...patch },
          updatedAt: Date.now(),
        };
        store.put(merged);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* IndexedDB unavailable — drop silently; the in-memory state still holds. */
  }
}

/** Reads the queued draft for this form (or null). */
export async function readQueuedDraft(
  caseId: string,
  formDefinitionId: string,
  partyId: string | null,
): Promise<QueuedDraft | null> {
  if (!hasIndexedDb()) return null;
  try {
    const db = await openDb();
    const key = draftKey(caseId, formDefinitionId, partyId);
    const result = await new Promise<QueuedDraft | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as QueuedDraft | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

/** Clears the queued draft once it has been synced to the server. */
export async function clearQueuedDraft(
  caseId: string,
  formDefinitionId: string,
  partyId: string | null,
): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDb();
    const key = draftKey(caseId, formDefinitionId, partyId);
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* ignore */
  }
}

/** Backoff schedule for retries (ms) — DOC-50 §6.3 (2s → 5s → 15s, then hold). */
export const BACKOFF_MS = [2000, 5000, 15000] as const;

export function backoffDelay(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
}
