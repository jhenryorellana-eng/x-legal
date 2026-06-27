/**
 * DraftStore — the durable local backup port for FormWizard autosave.
 *
 * It persists the OUTBOX: the answers the user has changed that the server has not
 * yet acknowledged. It is a transient cache/queue, NOT the source of truth — the
 * database is (DOC-24 §2.4: "Persistencia crítica en BD, no en el dispositivo;
 * localStorage/IndexedDB SOLO como cache/cola; el WebView puede purgar storage sin
 * previo aviso"). On reopen the page loads authoritative answers from BD and the
 * outbox only contributes edits that never reached BD.
 *
 * The engine talks to this PORT, never to IndexedDB directly, so it stays testable
 * in the node env (inject `createMemoryDraftStore`) and Capacitor-portable.
 *
 * One record per (caseId, formDefinitionId, partyId). `write` REPLACES the record:
 * the controller owns the in-memory merge, the store just persists the snapshot.
 */

const DB_NAME = "ulp-form-wizard";
const STORE = "drafts";
const DB_VERSION = 1;

export interface DraftRecord {
  /** Composite key: `${caseId}:${formDefinitionId}:${partyId ?? "_"}`. */
  key: string;
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  /** The unconfirmed answers delta awaiting sync ({ [questionId]: value }). */
  answers: Record<string, unknown>;
  updatedAt: number;
}

export interface DraftStore {
  read(key: string): Promise<DraftRecord | null>;
  write(record: DraftRecord): Promise<void>;
  clear(key: string): Promise<void>;
}

export function draftKey(caseId: string, formDefinitionId: string, partyId: string | null): string {
  return `${caseId}:${formDefinitionId}:${partyId ?? "_"}`;
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

// ---------------------------------------------------------------------------
// In-memory impl — test double + the executable contract for the IDB impl.
// ---------------------------------------------------------------------------

export function createMemoryDraftStore(): DraftStore {
  const map = new Map<string, DraftRecord>();
  return {
    async read(key) {
      const found = map.get(key);
      return found ? clone(found) : null;
    },
    async write(record) {
      map.set(record.key, clone(record));
    },
    async clear(key) {
      map.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// IndexedDB impl — singleton connection (gap 4). Never throws to the caller:
// a purged/unavailable store degrades silently (the in-memory outbox still
// holds; BD remains the source of truth).
// ---------------------------------------------------------------------------

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    // Another tab holds an older version open; it closes on its versionchange.
    req.onblocked = () => {};
    req.onsuccess = () => {
      const db = req.result;
      // Let other tabs upgrade: close on versionchange and force a reopen next call.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

export function createIndexedDbDraftStore(): DraftStore {
  return {
    async read(key) {
      if (!hasIndexedDb()) return null;
      try {
        const db = await openDb();
        return await new Promise<DraftRecord | null>((resolve, reject) => {
          const tx = db.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).get(key);
          req.onsuccess = () => resolve((req.result as DraftRecord | undefined) ?? null);
          req.onerror = () => reject(req.error);
        });
      } catch {
        return null;
      }
    },
    async write(record) {
      if (!hasIndexedDb()) return;
      try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } catch {
        /* storage unavailable/purged — degrade silently; BD wins. */
      }
    },
    async clear(key) {
      if (!hasIndexedDb()) return;
      try {
        const db = await openDb();
        await new Promise<void>((resolve) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      } catch {
        /* ignore */
      }
    },
  };
}
