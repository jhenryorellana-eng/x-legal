/**
 * Ola D — cronograma date math (pure helper).
 *
 * addWeeksToAnchorIso anchors the cronograma on cases.opened_at; null anchor
 * (case not yet active) → null dates; weeks add 7 days each.
 */

import { describe, it, expect } from "vitest";
import { addWeeksToAnchorIso, addDaysToAnchorIso } from "../domain";

describe("addWeeksToAnchorIso", () => {
  it("returns null when there is no anchor (case not active yet)", () => {
    expect(addWeeksToAnchorIso(null, 4)).toBeNull();
  });

  it("returns null for an unparseable anchor", () => {
    expect(addWeeksToAnchorIso("not-a-date", 2)).toBeNull();
  });

  it("adds week*7 days to the anchor (4 weeks → +28 days)", () => {
    const anchor = "2026-01-01T00:00:00.000Z";
    expect(addWeeksToAnchorIso(anchor, 4)).toBe("2026-01-29T00:00:00.000Z");
  });

  it("week 1 → +7 days", () => {
    expect(addWeeksToAnchorIso("2026-06-01T12:00:00.000Z", 1)).toBe("2026-06-08T12:00:00.000Z");
  });

  it("week 0 → same instant", () => {
    expect(addWeeksToAnchorIso("2026-06-01T12:00:00.000Z", 0)).toBe("2026-06-01T12:00:00.000Z");
  });
});

describe("addDaysToAnchorIso (stage deadline snapshot)", () => {
  it("returns null when there is no anchor", () => {
    expect(addDaysToAnchorIso(null, 7)).toBeNull();
  });

  it("returns null for an unparseable anchor", () => {
    expect(addDaysToAnchorIso("nope", 7)).toBeNull();
  });

  it("adds N days to the anchor (7 días → +7 días)", () => {
    expect(addDaysToAnchorIso("2026-06-30T17:43:16.000Z", 7)).toBe("2026-07-07T17:43:16.000Z");
  });

  it("day 1 → +1 día", () => {
    expect(addDaysToAnchorIso("2026-06-01T00:00:00.000Z", 1)).toBe("2026-06-02T00:00:00.000Z");
  });
});
