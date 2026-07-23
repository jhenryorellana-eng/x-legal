/**
 * business-days — holiday-aware working-day arithmetic over civil dates.
 *
 * Reference week (2026-07): Mon 20, Tue 21, Wed 22, Thu 23, Fri 24, Sat 25,
 * Sun 26, Mon 27. Weekends are always non-working; holidays are injected.
 */
import { describe, it, expect } from "vitest";
import {
  isNonWorkingDay,
  isBusinessDay,
  businessDaysUntil,
  addBusinessDays,
  subtractBusinessDays,
  addCalendarDays,
} from "../business-days";

const NONE = new Set<string>();

describe("isNonWorkingDay / isBusinessDay", () => {
  it("weekends are non-working regardless of the holiday set", () => {
    expect(isNonWorkingDay("2026-07-25", NONE)).toBe(true); // Sat
    expect(isNonWorkingDay("2026-07-26", NONE)).toBe(true); // Sun
    expect(isBusinessDay("2026-07-22", NONE)).toBe(true); // Wed
  });

  it("an injected holiday marks a weekday as non-working", () => {
    const h = new Set(["2026-07-23"]); // Thu
    expect(isNonWorkingDay("2026-07-23", h)).toBe(true);
    expect(isBusinessDay("2026-07-23", h)).toBe(false);
    expect(isBusinessDay("2026-07-23", NONE)).toBe(true);
  });

  it("rejects malformed input loudly", () => {
    expect(() => isNonWorkingDay("2026/07/22")).toThrow();
  });
});

describe("businessDaysUntil — (from, to] runway, from excluded", () => {
  it("counts working days after today up to and including the deadline", () => {
    expect(businessDaysUntil("2026-07-22", "2026-07-24", NONE)).toBe(2); // Thu, Fri
    expect(businessDaysUntil("2026-07-22", "2026-07-27", NONE)).toBe(3); // Thu, Fri, Mon (skip Sat/Sun)
    expect(businessDaysUntil("2026-07-24", "2026-07-27", NONE)).toBe(1); // Mon only
  });

  it("returns 0 when the deadline is today or already passed", () => {
    expect(businessDaysUntil("2026-07-22", "2026-07-22", NONE)).toBe(0);
    expect(businessDaysUntil("2026-07-24", "2026-07-22", NONE)).toBe(0);
  });

  it("excludes injected holidays from the runway (acceptance guard)", () => {
    const h = new Set(["2026-07-23"]); // Thu holiday
    expect(businessDaysUntil("2026-07-22", "2026-07-24", h)).toBe(1); // only Fri
  });
});

describe("addBusinessDays — cap for the legal stage", () => {
  it("skips weekends", () => {
    expect(addBusinessDays("2026-07-22", 1, NONE)).toBe("2026-07-23"); // Wed → Thu
    expect(addBusinessDays("2026-07-22", 3, NONE)).toBe("2026-07-27"); // Thu, Fri, Mon
    expect(addBusinessDays("2026-07-24", 1, NONE)).toBe("2026-07-27"); // Fri → Mon
  });

  it("n = 0 is a no-op", () => {
    expect(addBusinessDays("2026-07-22", 0, NONE)).toBe("2026-07-22");
  });

  it("skips injected holidays and crosses the year boundary", () => {
    const h = new Set(["2026-07-23"]);
    expect(addBusinessDays("2026-07-22", 1, h)).toBe("2026-07-24"); // skip Thu holiday
    expect(addBusinessDays("2026-12-31", 2, NONE)).toBe("2027-01-04"); // Thu → Fri 01-01, then Mon 01-04
  });
});

describe("subtractBusinessDays — the −1 mail buffer", () => {
  it("steps back over weekends", () => {
    expect(subtractBusinessDays("2026-07-27", 1, NONE)).toBe("2026-07-24"); // Mon → Fri
    expect(subtractBusinessDays("2026-07-27", 2, NONE)).toBe("2026-07-23"); // → Thu
  });

  it("steps back over injected holidays", () => {
    const h = new Set(["2026-07-23"]); // Thu holiday
    expect(subtractBusinessDays("2026-07-24", 1, h)).toBe("2026-07-22"); // Fri → skip Thu → Wed
  });

  it("n = 0 is a no-op", () => {
    expect(subtractBusinessDays("2026-07-24", 0, NONE)).toBe("2026-07-24");
  });
});

describe("addCalendarDays — the 30-day legal deadline (calendar, not business)", () => {
  it("adds calendar days across month and year boundaries", () => {
    expect(addCalendarDays("2026-07-22", 30)).toBe("2026-08-21");
    expect(addCalendarDays("2026-12-20", 30)).toBe("2027-01-19");
  });
});
