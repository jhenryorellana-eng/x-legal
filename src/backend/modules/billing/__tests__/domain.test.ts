/**
 * Billing domain — pure function tests (TDD).
 *
 * No I/O, no mocks needed.
 */

import { describe, it, expect } from "vitest";
import {
  buildInstallments,
  addMonthsClamped,
  canTransitionInstallment,
  reanchorDueDates,
  isOverdue,
  daysLate,
  PAYABLE_STATUSES,
  type InstallmentStatus,
  type InstallmentTransitionActor,
} from "../domain";

// ---------------------------------------------------------------------------
// buildInstallments — invariants (I1-I6, DOC-44 §2.1)
// ---------------------------------------------------------------------------

describe("buildInstallments", () => {
  it("I1 — sum of all installments equals totalCents", () => {
    const plans = buildInstallments({
      totalCents: 1000_00,
      downpaymentCents: 200_00,
      installmentCount: 5,
      startDate: "2024-01-15",
    });
    const total = plans.reduce((s, p) => s + p.amountCents, 0);
    expect(total).toBe(1000_00);
  });

  it("I2 — throws when downpaymentCents = 0", () => {
    expect(() =>
      buildInstallments({
        totalCents: 1000_00,
        downpaymentCents: 0,
        installmentCount: 4,
        startDate: "2024-01-15",
      }),
    ).toThrow(/downpaymentCents must be > 0/);
  });

  it("I2 — throws when downpaymentCents < 0", () => {
    expect(() =>
      buildInstallments({
        totalCents: 1000_00,
        downpaymentCents: -1,
        installmentCount: 4,
        startDate: "2024-01-15",
      }),
    ).toThrow(/downpaymentCents must be > 0/);
  });

  it("I2 — installmentCount must be >= 1", () => {
    expect(() =>
      buildInstallments({
        totalCents: 1000_00,
        downpaymentCents: 200_00,
        installmentCount: 0,
        startDate: "2024-01-15",
      }),
    ).toThrow();
  });

  it("I3 — downpaymentCents <= totalCents", () => {
    expect(() =>
      buildInstallments({
        totalCents: 500_00,
        downpaymentCents: 600_00,
        installmentCount: 3,
        startDate: "2024-01-15",
      }),
    ).toThrow();
  });

  it("I4 — installmentCount === 1 returns single downpayment installment", () => {
    const plans = buildInstallments({
      totalCents: 500_00,
      downpaymentCents: 500_00,
      installmentCount: 1,
      startDate: "2024-01-15",
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].isDownpayment).toBe(true);
    expect(plans[0].amountCents).toBe(500_00);
    expect(plans[0].number).toBe(1);
  });

  it("I5 — remaining installments share floor(remainder / N-1)", () => {
    // total=1000, down=100, count=4 → remainder=900, N-1=3, base=300 each
    const plans = buildInstallments({
      totalCents: 1000_00,
      downpaymentCents: 100_00,
      installmentCount: 4,
      startDate: "2024-01-01",
    });
    expect(plans).toHaveLength(4);
    expect(plans[1].amountCents).toBe(300_00);
    expect(plans[2].amountCents).toBe(300_00);
    expect(plans[3].amountCents).toBe(300_00); // last also 300 (no rounding needed)
  });

  it("I6 — last installment absorbs rounding difference", () => {
    const plans = buildInstallments({
      totalCents: 110,   // down=10, remainder=100, N-1=3 → base=33, last=34
      downpaymentCents: 10,
      installmentCount: 4,
      startDate: "2024-01-01",
    });
    expect(plans).toHaveLength(4);
    expect(plans[1].amountCents).toBe(33); // floor(100/3)=33
    expect(plans[2].amountCents).toBe(33);
    expect(plans[3].amountCents).toBe(34); // absorbs rounding: 100 - 33 - 33 = 34
    const total = plans.reduce((s, p) => s + p.amountCents, 0);
    expect(total).toBe(110);
  });

  it("I1 invariant holds for odd-cent rounding scenarios", () => {
    const plans = buildInstallments({
      totalCents: 9999,
      downpaymentCents: 1000,
      installmentCount: 7,
      startDate: "2024-03-01",
    });
    const total = plans.reduce((s, p) => s + p.amountCents, 0);
    expect(total).toBe(9999);
  });

  it("first installment is marked isDownpayment=true (I6 — exactly one)", () => {
    const plans = buildInstallments({
      totalCents: 600_00,
      downpaymentCents: 100_00,
      installmentCount: 3,
      startDate: "2024-01-01",
    });
    expect(plans[0].isDownpayment).toBe(true);
    expect(plans[1].isDownpayment).toBe(false);
    expect(plans[2].isDownpayment).toBe(false);
    // Only one downpayment
    expect(plans.filter((p) => p.isDownpayment)).toHaveLength(1);
  });

  it("I3 — installment numbers are sequential starting at 1", () => {
    const plans = buildInstallments({
      totalCents: 600_00,
      downpaymentCents: 100_00,
      installmentCount: 3,
      startDate: "2024-01-01",
    });
    expect(plans.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("I4 — due dates non-decreasing with number", () => {
    const plans = buildInstallments({
      totalCents: 600_00,
      downpaymentCents: 100_00,
      installmentCount: 4,
      startDate: "2024-01-01",
    });
    expect(plans[0].dueDate).toBe("2024-01-01");
    expect(plans[1].dueDate).toBe("2024-02-01");
    expect(plans[2].dueDate).toBe("2024-03-01");
    expect(plans[3].dueDate).toBe("2024-04-01");
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i].dueDate >= plans[i - 1].dueDate).toBe(true);
    }
  });

  it("throws if totalCents is negative", () => {
    expect(() =>
      buildInstallments({
        totalCents: -100,
        downpaymentCents: 1,
        installmentCount: 1,
        startDate: "2024-01-01",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// addMonthsClamped
// ---------------------------------------------------------------------------

describe("addMonthsClamped", () => {
  it("adds months normally", () => {
    expect(addMonthsClamped("2024-01-15", 1)).toBe("2024-02-15");
    expect(addMonthsClamped("2024-01-15", 3)).toBe("2024-04-15");
    expect(addMonthsClamped("2024-01-15", 12)).toBe("2025-01-15");
  });

  it("clamps to last day of month when day exceeds target month length", () => {
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29"); // 2024 is leap
    expect(addMonthsClamped("2023-01-31", 1)).toBe("2023-02-28"); // 2023 is not leap
  });

  it("handles year rollover", () => {
    expect(addMonthsClamped("2024-11-15", 2)).toBe("2025-01-15");
    expect(addMonthsClamped("2024-12-01", 1)).toBe("2025-01-01");
  });

  it("clamps March 31 + 1 month to April 30", () => {
    expect(addMonthsClamped("2024-03-31", 1)).toBe("2024-04-30");
  });

  it("adds 0 months returns same date", () => {
    expect(addMonthsClamped("2024-06-15", 0)).toBe("2024-06-15");
  });
});

// ---------------------------------------------------------------------------
// reanchorDueDates (DOC-44 §2.1, SOT-3)
// ---------------------------------------------------------------------------

describe("reanchorDueDates", () => {
  const installments = [
    { number: 1, amountCents: 100, dueDate: "2024-01-01", isDownpayment: true },
    { number: 2, amountCents: 100, dueDate: "2024-02-01", isDownpayment: false },
    { number: 3, amountCents: 100, dueDate: "2024-03-01", isDownpayment: false },
  ];

  it("sets downpayment dueDate = anchor", () => {
    const anchored = reanchorDueDates(installments, "2024-06-15");
    expect(anchored[0].dueDate).toBe("2024-06-15");
  });

  it("cuota k → addMonthsClamped(anchor, k-1)", () => {
    const anchored = reanchorDueDates(installments, "2024-06-15");
    expect(anchored[1].dueDate).toBe("2024-07-15"); // anchor + 1 month
    expect(anchored[2].dueDate).toBe("2024-08-15"); // anchor + 2 months
  });

  it("clamps when anchor is month-end", () => {
    const anchored = reanchorDueDates(installments, "2024-01-31");
    expect(anchored[0].dueDate).toBe("2024-01-31");
    expect(anchored[1].dueDate).toBe("2024-02-29"); // Feb 29 (2024 leap)
    expect(anchored[2].dueDate).toBe("2024-03-31");
  });

  it("does not mutate the original array", () => {
    const original = [...installments];
    reanchorDueDates(installments, "2025-03-15");
    expect(installments[0].dueDate).toBe(original[0].dueDate);
  });

  it("handles single installment (just downpayment)", () => {
    const single = [{ number: 1, amountCents: 500, dueDate: "2024-01-01", isDownpayment: true }];
    const anchored = reanchorDueDates(single, "2024-06-20");
    expect(anchored[0].dueDate).toBe("2024-06-20");
  });
});

// ---------------------------------------------------------------------------
// canTransitionInstallment (DOC-44 §2.2 actor-aware matrix)
// ---------------------------------------------------------------------------

describe("canTransitionInstallment", () => {
  // --- system actor ---
  it("system: pending → processing", () => {
    expect(canTransitionInstallment("pending", "processing", "system")).toBe(true);
  });

  it("system: processing → paid", () => {
    expect(canTransitionInstallment("processing", "paid", "system")).toBe(true);
  });

  it("system: processing → pending (revert on failure)", () => {
    expect(canTransitionInstallment("processing", "pending", "system")).toBe(true);
  });

  it("system: processing → overdue (failure when past due)", () => {
    expect(canTransitionInstallment("processing", "overdue", "system")).toBe(true);
  });

  it("system: paid → pending (charge.refunded path)", () => {
    expect(canTransitionInstallment("paid", "pending", "system")).toBe(true);
  });

  // --- cron actor ---
  it("cron: pending → overdue", () => {
    expect(canTransitionInstallment("pending", "overdue", "cron")).toBe(true);
  });

  it("cron cannot: pending → paid", () => {
    expect(canTransitionInstallment("pending", "paid", "cron")).toBe(false);
  });

  // --- finance actor ---
  it("finance: pending → paid (direct Zelle registration)", () => {
    expect(canTransitionInstallment("pending", "paid", "finance")).toBe(true);
  });

  it("finance: overdue → paid", () => {
    expect(canTransitionInstallment("overdue", "paid", "finance")).toBe(true);
  });

  it("finance: pending → waived", () => {
    expect(canTransitionInstallment("pending", "waived", "finance")).toBe(true);
  });

  it("finance: overdue → waived", () => {
    expect(canTransitionInstallment("overdue", "waived", "finance")).toBe(true);
  });

  it("finance cannot: pending → processing (only system)", () => {
    expect(canTransitionInstallment("pending", "processing", "finance")).toBe(false);
  });

  // --- admin actor ---
  it("admin: pending → paid", () => {
    expect(canTransitionInstallment("pending", "paid", "admin")).toBe(true);
  });

  it("admin: pending → waived", () => {
    expect(canTransitionInstallment("pending", "waived", "admin")).toBe(true);
  });

  // --- terminal states ---
  it("paid is terminal (system only exception: paid → pending via refund)", () => {
    const targets: InstallmentStatus[] = ["processing", "overdue", "waived"];
    const actors: InstallmentTransitionActor[] = ["system", "cron", "finance", "admin"];
    for (const to of targets) {
      for (const by of actors) {
        expect(canTransitionInstallment("paid", to, by), `paid → ${to} by ${by}`).toBe(false);
      }
    }
  });

  it("waived is terminal for all actors", () => {
    const targets: InstallmentStatus[] = ["pending", "processing", "overdue", "paid"];
    const actors: InstallmentTransitionActor[] = ["system", "cron", "finance", "admin"];
    for (const to of targets) {
      for (const by of actors) {
        expect(canTransitionInstallment("waived", to, by), `waived → ${to} by ${by}`).toBe(false);
      }
    }
  });

  it("overdue → processing only by system", () => {
    expect(canTransitionInstallment("overdue", "processing", "system")).toBe(true);
    expect(canTransitionInstallment("overdue", "processing", "finance")).toBe(false);
    expect(canTransitionInstallment("overdue", "processing", "admin")).toBe(false);
    expect(canTransitionInstallment("overdue", "processing", "cron")).toBe(false);
  });

  it("defaults to system actor when not specified", () => {
    // backward compatibility — no third arg
    expect(canTransitionInstallment("pending", "processing")).toBe(true);
    expect(canTransitionInstallment("pending", "paid")).toBe(false); // system cannot go pending→paid
  });
});

// ---------------------------------------------------------------------------
// PAYABLE_STATUSES
// ---------------------------------------------------------------------------

describe("PAYABLE_STATUSES", () => {
  it("includes pending and overdue", () => {
    expect(PAYABLE_STATUSES).toContain("pending");
    expect(PAYABLE_STATUSES).toContain("overdue");
  });

  it("does not include paid, processing, waived", () => {
    expect(PAYABLE_STATUSES).not.toContain("paid");
    expect(PAYABLE_STATUSES).not.toContain("processing");
    expect(PAYABLE_STATUSES).not.toContain("waived");
  });
});

// ---------------------------------------------------------------------------
// isOverdue / daysLate (DOC-44 §2.3)
// ---------------------------------------------------------------------------

describe("isOverdue", () => {
  it("returns false for paid installment regardless of date", () => {
    expect(isOverdue({ status: "paid", due_date: "2020-01-01" }, "2026-01-01")).toBe(false);
  });

  it("returns false for waived installment", () => {
    expect(isOverdue({ status: "waived", due_date: "2020-01-01" }, "2026-01-01")).toBe(false);
  });

  it("returns true for pending installment with due_date in the past", () => {
    expect(isOverdue({ status: "pending", due_date: "2024-01-01" }, "2024-01-02")).toBe(true);
  });

  it("returns false for pending installment not yet due (today = due_date)", () => {
    // due_date < today required
    expect(isOverdue({ status: "pending", due_date: "2024-06-15" }, "2024-06-15")).toBe(false);
  });

  it("returns true for overdue installment (status already overdue)", () => {
    expect(isOverdue({ status: "overdue", due_date: "2024-01-01" }, "2024-06-15")).toBe(true);
  });
});

describe("daysLate", () => {
  it("returns 0 when not yet due", () => {
    expect(daysLate({ due_date: "2026-12-31" }, "2026-01-01")).toBe(0);
  });

  it("returns 0 on the due date itself", () => {
    expect(daysLate({ due_date: "2024-06-15" }, "2024-06-15")).toBe(0);
  });

  it("returns 1 for one day late", () => {
    expect(daysLate({ due_date: "2024-06-14" }, "2024-06-15")).toBe(1);
  });

  it("returns 30 for a month late", () => {
    expect(daysLate({ due_date: "2024-05-15" }, "2024-06-14")).toBe(30);
  });
});
