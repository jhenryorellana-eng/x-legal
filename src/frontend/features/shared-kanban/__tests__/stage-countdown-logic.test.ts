import { describe, it, expect } from "vitest";
import {
  MS_PER_DAY,
  daysUntil,
  countdownTier,
  countdownLabel,
} from "../stage-countdown-logic";

const now = Date.UTC(2026, 6, 12, 12, 0, 0); // fixed anchor

describe("daysUntil", () => {
  it("ceils partial days up (7d minus a few hours still reads 7)", () => {
    expect(daysUntil(now + 7 * MS_PER_DAY - 3 * 60 * 60 * 1000, now)).toBe(7);
  });
  it("is 1 within the last day", () => {
    expect(daysUntil(now + 12 * 60 * 60 * 1000, now)).toBe(1);
  });
  it("is 0 exactly at the deadline", () => {
    expect(daysUntil(now, now)).toBe(0);
  });
  it("is negative once overdue", () => {
    expect(daysUntil(now - 2 * MS_PER_DAY, now)).toBe(-2);
  });
});

describe("countdownTier (rojo ≤1 · ámbar 1<d<7 · neutro ≥7)", () => {
  it("normal at exactly 7 días (7 días a más)", () => {
    expect(countdownTier(7)).toBe("normal");
    expect(countdownTier(10)).toBe("normal");
  });
  it("warn strictly between 1 and 7", () => {
    expect(countdownTier(2)).toBe("warn");
    expect(countdownTier(6)).toBe("warn");
  });
  it("hot at exactly 1 día", () => {
    expect(countdownTier(1)).toBe("hot");
  });
  it("overdue at 0 and negative (deadline reached or passed)", () => {
    expect(countdownTier(0)).toBe("overdue");
    expect(countdownTier(-0)).toBe("overdue");
    expect(countdownTier(-1)).toBe("overdue");
  });
});

// Regression: sub-day overdue must read "Vencido", not "Vence hoy" (Math.ceil → -0).
describe("sub-day overdue → Vencido (not Vence hoy)", () => {
  it("5h past the deadline is overdue, labeled Vencido", () => {
    const due = Date.UTC(2026, 6, 11, 10, 0, 0);
    const now = due + 5 * 60 * 60 * 1000; // 5h late
    const days = daysUntil(due, now);
    const tier = countdownTier(days);
    expect(tier).toBe("overdue");
    expect(countdownLabel(days, tier, "es")).toBe("Vencido");
    expect(countdownLabel(days, tier, "en")).toBe("Overdue");
  });
});

describe("countdownLabel", () => {
  it("pluralizes días and singular día (es)", () => {
    expect(countdownLabel(7, "normal", "es")).toBe("7 días");
    expect(countdownLabel(1, "hot", "es")).toBe("1 día");
  });
  it("says Vencido at 0 / -0 (deadline just reached)", () => {
    expect(countdownLabel(0, "overdue", "es")).toBe("Vencido");
    expect(countdownLabel(-0, "overdue", "es")).toBe("Vencido");
  });
  it("shows overdue with the días atraso (es/en)", () => {
    expect(countdownLabel(-1, "overdue", "es")).toBe("Vencido");
    expect(countdownLabel(-3, "overdue", "es")).toBe("Vencido · hace 3 d");
    expect(countdownLabel(-3, "overdue", "en")).toBe("Overdue · 3d ago");
  });
  it("localizes to en", () => {
    expect(countdownLabel(5, "warn", "en")).toBe("5 days");
  });
});
