import { describe, it, expect } from "vitest";
import { exhibitItemTitle, placeExhibitsAfterMemo } from "../domain";

describe("exhibitItemTitle", () => {
  it("builds a court-style title from label + publisher + title", () => {
    expect(exhibitItemTitle({ exhibitLabel: "B-1", publisher: "HRW", title: "Venezuela 2024" })).toBe(
      "Exhibit B-1 — HRW — Venezuela 2024",
    );
  });
  it("falls back gracefully when fields are missing", () => {
    expect(exhibitItemTitle({ exhibitLabel: null, publisher: null, title: null })).toBe("Exhibit — Source");
    expect(exhibitItemTitle({ exhibitLabel: "A-2", publisher: "SCOTUS", title: "SCOTUS" })).toBe(
      "Exhibit A-2 — SCOTUS",
    );
  });
});

describe("placeExhibitsAfterMemo", () => {
  const items = (specs: Array<[string, string]>) => specs.map(([id, itemType]) => ({ id, itemType }));

  it("inserts new exhibit ids right after the memo item", () => {
    const order = items([
      ["cover1", "cover"],
      ["memo", "ai_generation"],
      ["doc1", "client_document"],
    ]);
    expect(placeExhibitsAfterMemo(order, "memo", ["ex1", "ex2"])).toEqual([
      "cover1",
      "memo",
      "ex1",
      "ex2",
      "doc1",
    ]);
  });

  it("places new exhibits after exhibits already trailing the memo (idempotent re-run)", () => {
    const order = items([
      ["memo", "ai_generation"],
      ["exA", "exhibit"],
      ["doc1", "client_document"],
    ]);
    expect(placeExhibitsAfterMemo(order, "memo", ["exB"])).toEqual(["memo", "exA", "exB", "doc1"]);
  });

  it("appends at the end when the anchor memo is not present", () => {
    const order = items([["doc1", "client_document"]]);
    expect(placeExhibitsAfterMemo(order, "memo", ["ex1"])).toEqual(["doc1", "ex1"]);
  });
});
