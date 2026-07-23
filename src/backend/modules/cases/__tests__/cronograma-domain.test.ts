/**
 * Ola D — cronograma date math (pure helper).
 *
 * addWeeksToAnchorIso anchors the cronograma on cases.opened_at; null anchor
 * (case not yet active) → null dates; weeks add 7 days each.
 */

import { describe, it, expect } from "vitest";
import { addWeeksToAnchorIso, addDaysToAnchorIso, computeDeadlineAnchoredDueYmd } from "../domain";

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

describe("computeDeadlineAnchoredDueYmd (Diana's dynamic due date)", () => {
  const NONE = new Set<string>();
  // Reference week: Wed 2026-07-22, Thu 23, Fri 24, Sat 25, Sun 26, Mon 27, Tue 28.

  it("cap wins when the deadline is far: entered + maxBusinessDays", () => {
    // cap = addBiz(07-22, 4) = 07-28; shipBy = subBiz(08-21 Fri, 1) = 08-20 → min 07-28.
    expect(
      computeDeadlineAnchoredDueYmd({
        enteredYmd: "2026-07-22",
        deadlineYmd: "2026-08-21",
        maxBusinessDays: 4,
        mailBufferBusinessDays: 1,
        holidays: NONE,
      }),
    ).toBe("2026-07-28");
  });

  it("buffer wins when the deadline is close: deadline − mailBuffer", () => {
    // cap = 07-28; shipBy = subBiz(07-27 Mon, 1) = Fri 07-24 → min 07-24.
    expect(
      computeDeadlineAnchoredDueYmd({
        enteredYmd: "2026-07-22",
        deadlineYmd: "2026-07-27",
        maxBusinessDays: 4,
        mailBufferBusinessDays: 1,
        holidays: NONE,
      }),
    ).toBe("2026-07-24");
  });

  it("mailBuffer 0 → shipBy is the deadline itself (cap still applies)", () => {
    expect(
      computeDeadlineAnchoredDueYmd({
        enteredYmd: "2026-07-22",
        deadlineYmd: "2026-07-24",
        maxBusinessDays: 4,
        mailBufferBusinessDays: 0,
        holidays: NONE,
      }),
    ).toBe("2026-07-24"); // cap 07-28 vs shipBy 07-24 → 07-24
  });

  it("excludes injected holidays from both bounds", () => {
    const h = new Set(["2026-07-23"]); // Thu closed
    // cap = addBiz(07-22, 4, {Thu23}) = Fri24,Mon27,Tue28,Wed29 → 07-29;
    // shipBy = subBiz(08-21, 1) = 08-20 → min 07-29.
    expect(
      computeDeadlineAnchoredDueYmd({
        enteredYmd: "2026-07-22",
        deadlineYmd: "2026-08-21",
        maxBusinessDays: 4,
        mailBufferBusinessDays: 1,
        holidays: h,
      }),
    ).toBe("2026-07-29");
  });
});
