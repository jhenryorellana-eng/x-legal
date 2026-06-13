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
  type InstallmentStatus,
} from "../domain";

// ---------------------------------------------------------------------------
// buildInstallments — invariants
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
    // total=1000, down=100, count=4 → remainder=900, N-1=3, base=floor(900/3)=300
    // No rounding here: 300*3=900. Use an amount that forces rounding:
    // total=1003, down=100, count=4 → remainder=903, base=floor(903/3)=301
    // plans: 301+301=602, last = 903-602 = 301 → actually no rounding either
    // Use remainder=10, N-1=3 → base=floor(10/3)=3, last=10-3-3=4
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
    // 7 installments, 3 remaining after downpayment — many rounding combos
    const plans = buildInstallments({
      totalCents: 9999,
      downpaymentCents: 1000,
      installmentCount: 7,
      startDate: "2024-03-01",
    });
    const total = plans.reduce((s, p) => s + p.amountCents, 0);
    expect(total).toBe(9999);
  });

  it("first installment is marked isDownpayment=true", () => {
    const plans = buildInstallments({
      totalCents: 600_00,
      downpaymentCents: 100_00,
      installmentCount: 3,
      startDate: "2024-01-01",
    });
    expect(plans[0].isDownpayment).toBe(true);
    expect(plans[1].isDownpayment).toBe(false);
    expect(plans[2].isDownpayment).toBe(false);
  });

  it("installment numbers are sequential starting at 1", () => {
    const plans = buildInstallments({
      totalCents: 600_00,
      downpaymentCents: 100_00,
      installmentCount: 3,
      startDate: "2024-01-01",
    });
    expect(plans.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("due dates increase by one month each installment after downpayment", () => {
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
  });

  it("zero-cent totalCents returns single installment with 0 amount", () => {
    const plans = buildInstallments({
      totalCents: 0,
      downpaymentCents: 0,
      installmentCount: 1,
      startDate: "2024-01-01",
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].amountCents).toBe(0);
  });

  it("throws if totalCents is negative", () => {
    expect(() =>
      buildInstallments({
        totalCents: -100,
        downpaymentCents: 0,
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
    // Jan 31 + 1 month = Feb 28/29
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
// canTransitionInstallment
// ---------------------------------------------------------------------------

describe("canTransitionInstallment", () => {
  it("allows pending → paid", () => {
    expect(canTransitionInstallment("pending", "paid")).toBeNull();
  });

  it("allows pending → processing", () => {
    expect(canTransitionInstallment("pending", "processing")).toBeNull();
  });

  it("allows pending → overdue", () => {
    expect(canTransitionInstallment("pending", "overdue")).toBeNull();
  });

  it("allows pending → waived", () => {
    expect(canTransitionInstallment("pending", "waived")).toBeNull();
  });

  it("allows processing → paid", () => {
    expect(canTransitionInstallment("processing", "paid")).toBeNull();
  });

  it("allows processing → pending (revert on failure)", () => {
    expect(canTransitionInstallment("processing", "pending")).toBeNull();
  });

  it("allows overdue → paid", () => {
    expect(canTransitionInstallment("overdue", "paid")).toBeNull();
  });

  it("allows overdue → waived", () => {
    expect(canTransitionInstallment("overdue", "waived")).toBeNull();
  });

  it("denies paid → anything (terminal)", () => {
    const targets: InstallmentStatus[] = ["pending", "processing", "overdue", "waived"];
    for (const to of targets) {
      expect(canTransitionInstallment("paid", to), `paid → ${to}`).toBe(
        "INSTALLMENT_INVALID_TRANSITION",
      );
    }
  });

  it("denies waived → anything (terminal)", () => {
    const targets: InstallmentStatus[] = ["pending", "processing", "overdue", "paid"];
    for (const to of targets) {
      expect(canTransitionInstallment("waived", to), `waived → ${to}`).toBe(
        "INSTALLMENT_INVALID_TRANSITION",
      );
    }
  });

  it("denies overdue → processing", () => {
    expect(canTransitionInstallment("overdue", "processing")).toBe(
      "INSTALLMENT_INVALID_TRANSITION",
    );
  });
});
