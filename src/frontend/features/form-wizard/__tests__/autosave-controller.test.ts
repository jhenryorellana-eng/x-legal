import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAutosaveController, type AutosaveController } from "../autosave-controller";
import { createMemoryDraftStore, draftKey, type DraftStore } from "../draft-store";
import type { SaveDraftResult } from "../types";

/**
 * The controller is the autosave engine, extracted from React so its robustness
 * (write-ahead durability, offline queueing, error classification, no-data-loss
 * on close) can be proven without a browser. These tests are the spec.
 */

const CASE = "case-1";
const FORM = "form-1";
const KEY = draftKey(CASE, FORM, null);

const TIMING = {
  debounceMs: 1000,
  writeAheadMs: 200,
  backoffMs: [1000, 2000] as const,
  savedFadeMs: 500,
  maxTransientAttempts: 2,
};

type SaveCall = { patch: Record<string, unknown> };

/** A controllable saveDraft test double (dependency injection, not a lib mock). */
function makeSaveDraft() {
  const calls: SaveCall[] = [];
  let mode: "ok" | "error" | "throw" = "ok";
  let result: SaveDraftResult = { ok: true, responseId: "resp-1" };
  let deferred: { resolve: (r: SaveDraftResult) => void; promise: Promise<SaveDraftResult> } | null = null;

  const fn = vi.fn(async (input: { patch: Record<string, unknown> }) => {
    calls.push({ patch: { ...input.patch } });
    if (deferred) return deferred.promise;
    if (mode === "throw") throw new Error("network down");
    return result;
  });

  return {
    fn,
    calls,
    setOk(responseId = "resp-1") {
      mode = "ok";
      result = { ok: true, responseId };
      deferred = null;
    },
    setError(res: SaveDraftResult) {
      mode = "error";
      result = res;
      deferred = null;
    },
    setThrow() {
      mode = "throw";
      deferred = null;
    },
    /** Make the NEXT call hang until release(); returns release fn. */
    hang() {
      let resolveFn!: (r: SaveDraftResult) => void;
      const promise = new Promise<SaveDraftResult>((res) => {
        resolveFn = res;
      });
      deferred = { resolve: resolveFn, promise };
      return (r: SaveDraftResult = { ok: true, responseId: "resp-1" }) => {
        deferred = null;
        resolveFn(r);
      };
    },
  };
}

function makeController(
  saveDraft: ReturnType<typeof makeSaveDraft>["fn"],
  store: DraftStore,
  online = true,
): { ctrl: AutosaveController } {
  const ctrl = createAutosaveController({
    caseId: CASE,
    formDefinitionId: FORM,
    partyId: null,
    saveDraft: saveDraft as unknown as Parameters<typeof createAutosaveController>[0]["saveDraft"],
    store,
    onChange: () => {},
    config: TIMING,
    initialOnline: online,
  });
  return { ctrl };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("AutosaveController — debounce + save", () => {
  it("coalesces rapid edits into one save after the debounce window", async () => {
    const save = makeSaveDraft();
    const store = createMemoryDraftStore();
    const { ctrl } = makeController(save.fn, store);

    ctrl.scheduleSave({ q1: "a" });
    ctrl.scheduleSave({ q1: "ab" });
    ctrl.scheduleSave({ q2: "x" });
    expect(save.calls).toHaveLength(0); // nothing fired yet

    await vi.advanceTimersByTimeAsync(TIMING.debounceMs);
    expect(save.calls).toHaveLength(1);
    expect(save.calls[0].patch).toEqual({ q1: "ab", q2: "x" });
    expect(ctrl.getSnapshot().saveState).toBe("saved");
    ctrl.dispose();
  });

  it("flush() saves immediately without waiting for the debounce", async () => {
    const save = makeSaveDraft();
    const { ctrl } = makeController(save.fn, createMemoryDraftStore());
    ctrl.scheduleSave({ q1: "a" });
    ctrl.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(save.calls).toHaveLength(1);
    ctrl.dispose();
  });
});

describe("AutosaveController — write-ahead durability (gap 1)", () => {
  it("persists the outbox to the store on every change, before any network save", async () => {
    const save = makeSaveDraft();
    const store = createMemoryDraftStore();
    const { ctrl } = makeController(save.fn, store);

    ctrl.scheduleSave({ q1: "typed" });
    await vi.advanceTimersByTimeAsync(TIMING.writeAheadMs);

    // Saved locally already, even though the debounce hasn't fired the network save.
    expect(save.calls).toHaveLength(0);
    const rec = await store.read(KEY);
    expect(rec?.answers).toEqual({ q1: "typed" });
    ctrl.dispose();
  });

  it("clears the store once everything is confirmed by the server", async () => {
    const save = makeSaveDraft();
    const store = createMemoryDraftStore();
    const { ctrl } = makeController(save.fn, store);
    ctrl.scheduleSave({ q1: "a" });
    await vi.advanceTimersByTimeAsync(TIMING.debounceMs);
    expect(await store.read(KEY)).toBeNull(); // synced → local backup cleared
    ctrl.dispose();
  });
});

describe("AutosaveController — serialization + mid-flight edits", () => {
  it("never overlaps saves and flushes remaining edits after the in-flight one", async () => {
    const save = makeSaveDraft();
    const { ctrl } = makeController(save.fn, createMemoryDraftStore());
    const release = save.hang();

    ctrl.scheduleSave({ q1: "a" });
    ctrl.flush(); // starts save #1 (hanging)
    await vi.advanceTimersByTimeAsync(0);
    expect(save.calls).toHaveLength(1);

    ctrl.scheduleSave({ q2: "b" }); // typed during the in-flight save
    ctrl.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(save.calls).toHaveLength(1); // still serialized — not sent yet

    release({ ok: true, responseId: "resp-1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(save.calls).toHaveLength(2);
    expect(save.calls[1].patch).toEqual({ q2: "b" });
    ctrl.dispose();
  });

  it("retains a key re-typed during the in-flight save (no lost keystroke)", async () => {
    const save = makeSaveDraft();
    const store = createMemoryDraftStore();
    const { ctrl } = makeController(save.fn, store);
    const release = save.hang();

    ctrl.scheduleSave({ q1: "first" });
    ctrl.flush();
    await vi.advanceTimersByTimeAsync(0);

    ctrl.scheduleSave({ q1: "second" }); // same key, new value, mid-flight
    release({ ok: true, responseId: "resp-1" }); // confirms "first"
    await vi.advanceTimersByTimeAsync(0);

    // "second" must NOT be trimmed by the confirmation of "first".
    expect(save.calls).toHaveLength(2);
    expect(save.calls[1].patch).toEqual({ q1: "second" });
    ctrl.dispose();
  });
});

describe("AutosaveController — offline (gap 1/2)", () => {
  it("queues locally without hitting the network while offline", async () => {
    const save = makeSaveDraft();
    const store = createMemoryDraftStore();
    const { ctrl } = makeController(save.fn, store, false);

    ctrl.scheduleSave({ q1: "offline-edit" });
    ctrl.flush();
    await vi.advanceTimersByTimeAsync(TIMING.debounceMs);

    expect(save.calls).toHaveLength(0); // no network while offline
    expect(ctrl.getSnapshot().saveState).toBe("queued");
    expect((await store.read(KEY))?.answers).toEqual({ q1: "offline-edit" });
    ctrl.dispose();
  });

  it("syncs the queued outbox when it comes back online", async () => {
    const save = makeSaveDraft();
    const store = createMemoryDraftStore();
    const { ctrl } = makeController(save.fn, store, false);
    ctrl.scheduleSave({ q1: "offline-edit" });
    await vi.advanceTimersByTimeAsync(TIMING.writeAheadMs);
    expect(save.calls).toHaveLength(0);

    ctrl.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(save.calls).toHaveLength(1);
    expect(save.calls[0].patch).toEqual({ q1: "offline-edit" });
    expect(ctrl.getSnapshot().saveState).toBe("saved");
    ctrl.dispose();
  });
});

describe("AutosaveController — error classification (gap 3)", () => {
  it("stops retrying on a permanent error and goes to blocked, keeping the outbox", async () => {
    const save = makeSaveDraft();
    const store = createMemoryDraftStore();
    const { ctrl } = makeController(save.fn, store);
    save.setError({ ok: false, error: { code: "FORM_NOT_SUBMITTABLE" } });

    ctrl.scheduleSave({ q1: "a" });
    await vi.advanceTimersByTimeAsync(TIMING.debounceMs);
    expect(save.calls).toHaveLength(1);
    expect(ctrl.getSnapshot().saveState).toBe("blocked");
    expect(ctrl.getSnapshot().blockedCode).toBe("FORM_NOT_SUBMITTABLE");

    // No retry, ever — and the data is still safe locally.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save.calls).toHaveLength(1);
    expect((await store.read(KEY))?.answers).toEqual({ q1: "a" });
    ctrl.dispose();
  });

  it("retries a transient error with backoff, then stops after the bound", async () => {
    const save = makeSaveDraft();
    const { ctrl } = makeController(save.fn, createMemoryDraftStore());
    save.setError({ ok: false, error: { code: "UNEXPECTED" } });

    ctrl.scheduleSave({ q1: "a" });
    await vi.advanceTimersByTimeAsync(TIMING.debounceMs);
    expect(save.calls).toHaveLength(1);
    expect(ctrl.getSnapshot().saveState).toBe("error");

    await vi.advanceTimersByTimeAsync(TIMING.backoffMs[0]);
    expect(save.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(TIMING.backoffMs[1]);
    expect(save.calls).toHaveLength(3); // maxTransientAttempts=2 retries after the first

    await vi.advanceTimersByTimeAsync(60_000);
    expect(save.calls).toHaveLength(3); // bounded — no infinite loop
    ctrl.dispose();
  });

  it("trusts the server's retryable flag over the local code list", async () => {
    const save = makeSaveDraft();
    const { ctrl } = makeController(save.fn, createMemoryDraftStore());
    // A normally-permanent code, but the server says retryable=false → still permanent.
    save.setError({ ok: false, retryable: false, error: { code: "WHATEVER_NEW_CODE" } });
    ctrl.scheduleSave({ q1: "a" });
    await vi.advanceTimersByTimeAsync(TIMING.debounceMs);
    expect(ctrl.getSnapshot().saveState).toBe("blocked");
    ctrl.dispose();
  });
});

describe("AutosaveController — network throw (gap 2)", () => {
  it("queues on a thrown save and resyncs on reconnect", async () => {
    const save = makeSaveDraft();
    const store = createMemoryDraftStore();
    const { ctrl } = makeController(save.fn, store);
    save.setThrow();

    ctrl.scheduleSave({ q1: "a" });
    await vi.advanceTimersByTimeAsync(TIMING.debounceMs);
    expect(ctrl.getSnapshot().saveState).toBe("queued");
    expect((await store.read(KEY))?.answers).toEqual({ q1: "a" });

    save.setOk();
    ctrl.setOnline(false);
    ctrl.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(save.calls.length).toBeGreaterThanOrEqual(2);
    expect(ctrl.getSnapshot().saveState).toBe("saved");
    ctrl.dispose();
  });
});

describe("AutosaveController — edge values", () => {
  it("drops undefined keys (not serializable) but keeps '' and false", async () => {
    const save = makeSaveDraft();
    const { ctrl } = makeController(save.fn, createMemoryDraftStore());
    ctrl.scheduleSave({ q1: "", q2: false, q3: undefined });
    await vi.advanceTimersByTimeAsync(TIMING.debounceMs);
    expect(save.calls).toHaveLength(1);
    expect(save.calls[0].patch).toEqual({ q1: "", q2: false });
    ctrl.dispose();
  });

  it("does nothing when a patch is entirely undefined", async () => {
    const save = makeSaveDraft();
    const store = createMemoryDraftStore();
    const { ctrl } = makeController(save.fn, store);
    ctrl.scheduleSave({ q1: undefined });
    await vi.advanceTimersByTimeAsync(TIMING.debounceMs);
    expect(save.calls).toHaveLength(0);
    expect(await store.read(KEY)).toBeNull();
    ctrl.dispose();
  });
});

describe("AutosaveController — hydrate + responseId", () => {
  it("hydrates a previous outbox from the store, returns it, and syncs it when online", async () => {
    const save = makeSaveDraft();
    const store = createMemoryDraftStore();
    await store.write({ key: KEY, caseId: CASE, formDefinitionId: FORM, partyId: null, answers: { q1: "from-idb" }, updatedAt: 1 });
    const { ctrl } = makeController(save.fn, store);

    const hydrated = await ctrl.hydrate(); // returns the recovered outbox for the UI
    expect(hydrated).toEqual({ q1: "from-idb" });
    await vi.advanceTimersByTimeAsync(0);
    expect(save.calls).toHaveLength(1);
    expect(save.calls[0].patch).toEqual({ q1: "from-idb" });
    ctrl.dispose();
  });

  it("returns null from hydrate when there is no stored outbox", async () => {
    const save = makeSaveDraft();
    const { ctrl } = makeController(save.fn, createMemoryDraftStore());
    expect(await ctrl.hydrate()).toBeNull();
    ctrl.dispose();
  });

  it("exposes responseId after the first successful save", async () => {
    const save = makeSaveDraft();
    const { ctrl } = makeController(save.fn, createMemoryDraftStore());
    save.setOk("resp-42");
    ctrl.scheduleSave({ q1: "a" });
    await vi.advanceTimersByTimeAsync(TIMING.debounceMs);
    expect(ctrl.getSnapshot().responseId).toBe("resp-42");
    ctrl.dispose();
  });
});
