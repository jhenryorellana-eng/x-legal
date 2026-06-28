/**
 * Retention domain — pure helpers (discounts, referral codes, NPS).
 */

import { describe, it, expect } from "vitest";
import {
  promotionBlockReason,
  computeDiscountCents,
  normalizePromoCode,
  referralCodeFor,
  computeNps,
  averageRating,
} from "../domain";

const ACTIVE = {
  isActive: true,
  validFrom: null,
  validUntil: null,
  maxUses: null,
  usedCount: 0,
  serviceScope: null,
};

describe("promotionBlockReason", () => {
  const now = "2026-06-15T12:00:00.000Z";
  it("redeemable → null", () => {
    expect(promotionBlockReason(ACTIVE, now)).toBeNull();
  });
  it("inactive", () => {
    expect(promotionBlockReason({ ...ACTIVE, isActive: false }, now)).toBe("inactive");
  });
  it("not started / expired", () => {
    expect(promotionBlockReason({ ...ACTIVE, validFrom: "2026-07-01T00:00:00.000Z" }, now)).toBe("not_started");
    expect(promotionBlockReason({ ...ACTIVE, validUntil: "2026-06-01T00:00:00.000Z" }, now)).toBe("expired");
  });
  it("exhausted", () => {
    expect(promotionBlockReason({ ...ACTIVE, maxUses: 3, usedCount: 3 }, now)).toBe("exhausted");
  });
  it("service excluded", () => {
    expect(promotionBlockReason({ ...ACTIVE, serviceScope: ["svc-a"] }, now, "svc-b")).toBe("service_excluded");
    expect(promotionBlockReason({ ...ACTIVE, serviceScope: ["svc-a"] }, now, "svc-a")).toBeNull();
  });
});

describe("computeDiscountCents", () => {
  it("percent is proportional and clamped", () => {
    expect(computeDiscountCents("percent", 10, 10000)).toBe(1000);
    expect(computeDiscountCents("percent", 200, 10000)).toBe(10000); // clamp 100%
  });
  it("amount is capped at the base", () => {
    expect(computeDiscountCents("amount", 3000, 10000)).toBe(3000);
    expect(computeDiscountCents("amount", 15000, 10000)).toBe(10000);
  });
  it("zero base → zero", () => {
    expect(computeDiscountCents("percent", 50, 0)).toBe(0);
  });
});

describe("normalizePromoCode", () => {
  it("uppercases, trims, strips invalid chars", () => {
    expect(normalizePromoCode("  verano-2026! ")).toBe("VERANO-2026");
  });
});

describe("referralCodeFor", () => {
  it("is deterministic, 8 chars, unambiguous alphabet", () => {
    const a = referralCodeFor("user-123");
    const b = referralCodeFor("user-123");
    expect(a).toBe(b);
    expect(a).toHaveLength(8);
    expect(a).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });
  it("differs across users", () => {
    expect(referralCodeFor("user-1")).not.toBe(referralCodeFor("user-2"));
  });
});

describe("computeNps + averageRating", () => {
  it("NPS = %promoters − %detractors", () => {
    // 2 promoters (9,10), 1 passive (7), 1 detractor (3) → (2-1)/4 = 25
    expect(computeNps([9, 10, 7, 3])).toBe(25);
    expect(computeNps([])).toBe(0);
  });
  it("average rating rounded to 1 decimal", () => {
    expect(averageRating([5, 4, 4])).toBe(4.3);
    expect(averageRating([])).toBe(0);
  });
});
