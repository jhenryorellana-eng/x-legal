import { describe, it, expect } from "vitest";
import {
  splitChronologyWindows,
  buildChronologyTable,
  type ChronologyEvent,
} from "../domain";

function ev(over: Partial<ChronologyEvent> = {}): ChronologyEvent {
  return { date: "2022-01-01", event: "An incident", consequence: "Harm", exhibit: null, ...over };
}

describe("splitChronologyWindows", () => {
  it("returns three empty windows for an empty timeline", () => {
    expect(splitChronologyWindows([])).toEqual({ early: [], middle: [], final: [] });
  });

  it("splits evenly when the count is divisible by three", () => {
    const events = [ev({ event: "1" }), ev({ event: "2" }), ev({ event: "3" }), ev({ event: "4" }), ev({ event: "5" }), ev({ event: "6" })];
    const w = splitChronologyWindows(events);
    expect(w.early.map((e) => e.event)).toEqual(["1", "2"]);
    expect(w.middle.map((e) => e.event)).toEqual(["3", "4"]);
    expect(w.final.map((e) => e.event)).toEqual(["5", "6"]);
  });

  it("front-loads the remainder onto the earlier windows (n=10 → 4/3/3)", () => {
    const events = Array.from({ length: 10 }, (_, i) => ev({ event: String(i + 1) }));
    const w = splitChronologyWindows(events);
    expect(w.early).toHaveLength(4);
    expect(w.middle).toHaveLength(3);
    expect(w.final).toHaveLength(3);
  });

  it("keeps every event when fewer than three (n=2 → early, middle, empty final)", () => {
    const w = splitChronologyWindows([ev({ event: "a" }), ev({ event: "b" })]);
    expect(w.early.map((e) => e.event)).toEqual(["a"]);
    expect(w.middle.map((e) => e.event)).toEqual(["b"]);
    expect(w.final).toEqual([]);
  });

  it("sorts events chronologically before splitting", () => {
    const events = [ev({ date: "2023-05-01", event: "late" }), ev({ date: "2021-01-01", event: "early" }), ev({ date: "2022-03-01", event: "mid" })];
    const w = splitChronologyWindows(events);
    expect(w.early[0].event).toBe("early");
    expect(w.middle[0].event).toBe("mid");
    expect(w.final[0].event).toBe("late");
  });
});

describe("buildChronologyTable", () => {
  it("renders a markdown table with a header and one row per event", () => {
    const table = buildChronologyTable([
      ev({ date: "2021-06-15", event: "First threat", consequence: "Fled home", exhibit: "A-3" }),
    ]);
    expect(table).toContain("| Date |");
    expect(table).toContain("2021-06-15");
    expect(table).toContain("First threat");
    expect(table).toContain("Fled home");
    expect(table).toContain("A-3");
  });

  it("renders an em dash for a missing exhibit reference", () => {
    const table = buildChronologyTable([ev({ exhibit: null })]);
    expect(table).toContain("—");
  });

  it("returns an empty string for an empty timeline", () => {
    expect(buildChronologyTable([])).toBe("");
  });
});
