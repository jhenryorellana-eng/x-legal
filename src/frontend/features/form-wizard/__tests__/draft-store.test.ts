import { describe, it, expect } from "vitest";
import { createMemoryDraftStore, draftKey, type DraftRecord } from "../draft-store";

/**
 * The DraftStore port is the durable local backup for autosave. The in-memory
 * impl is the test double for the engine and the executable spec of the contract
 * the IndexedDB impl must also satisfy (the real IDB impl is exercised via the
 * Playwright offline path, not here — vitest runs in the node env, no IndexedDB).
 */

const rec = (answers: Record<string, unknown>, partyId: string | null = null): DraftRecord => ({
  key: draftKey("case-1", "form-1", partyId),
  caseId: "case-1",
  formDefinitionId: "form-1",
  partyId,
  answers,
  updatedAt: 1,
});

describe("draftKey", () => {
  it("builds a composite key, using '_' for a null party", () => {
    expect(draftKey("c", "f", null)).toBe("c:f:_");
    expect(draftKey("c", "f", "p")).toBe("c:f:p");
  });
});

describe("createMemoryDraftStore (DraftStore contract)", () => {
  it("returns null for an unknown key", async () => {
    const store = createMemoryDraftStore();
    expect(await store.read("missing")).toBeNull();
  });

  it("writes a record and reads it back", async () => {
    const store = createMemoryDraftStore();
    const r = rec({ q1: "hello" });
    await store.write(r);
    expect(await store.read(r.key)).toEqual(r);
  });

  it("write replaces the stored record (the controller owns the merge, not the store)", async () => {
    const store = createMemoryDraftStore();
    await store.write(rec({ q1: "a", q2: "b" }));
    await store.write(rec({ q1: "z" }));
    expect((await store.read(draftKey("case-1", "form-1", null)))?.answers).toEqual({ q1: "z" });
  });

  it("clear removes the record", async () => {
    const store = createMemoryDraftStore();
    const r = rec({ q1: "x" });
    await store.write(r);
    await store.clear(r.key);
    expect(await store.read(r.key)).toBeNull();
  });

  it("isolates records by key (per-party scoping)", async () => {
    const store = createMemoryDraftStore();
    await store.write(rec({ q1: "no-party" }));
    await store.write(rec({ q1: "party" }, "p1"));
    expect((await store.read(draftKey("case-1", "form-1", null)))?.answers).toEqual({ q1: "no-party" });
    expect((await store.read(draftKey("case-1", "form-1", "p1")))?.answers).toEqual({ q1: "party" });
  });

  it("snapshots data so later mutation of the input object can't corrupt the store", async () => {
    const store = createMemoryDraftStore();
    const answers = { q1: "a" };
    const r = rec(answers);
    await store.write(r);
    answers.q1 = "mutated";
    expect((await store.read(r.key))?.answers).toEqual({ q1: "a" });
  });
});
