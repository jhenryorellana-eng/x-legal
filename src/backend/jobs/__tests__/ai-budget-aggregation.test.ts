/**
 * Job: ai-budget-aggregation — unit tests (RNF-042 / DOC-74 §5.3).
 *
 * Covers:
 * - threshold mode: ratio < 0.8 → no notification
 * - threshold mode: ratio == 0.8 → over_80 notification with correct dedupeKey
 * - threshold mode: ratio == 1.0 → over_100 notification with correct dedupeKey
 * - threshold mode: ratio > 1.0 → only over_100, NOT over_80
 * - idempotency: two executions with same input produce same dedupeKey, no throw
 * - no budget configured → no notification
 * - monthly-close mode → monthly_close notification with prev-month dedupeKey
 * - invalid payload → early return, no side effects
 *
 * All I/O (supabase, ai-engine, notifications, logger) is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------

const mockInsertNotificationIdempotent = vi.hoisted(() => vi.fn());
const mockSumMonthlyCosts = vi.hoisted(() => vi.fn());

// Supabase chainable builder — we need to control what from('orgs') and
// from('users') return independently, so we keep them as separate vi.fn() refs.
const mockOrgsData = vi.hoisted(
  () =>
    ({
      data: [{ id: "org1", settings: { ai_budget_usd: 100 } }],
    }) as { data: Array<{ id: string; settings: Record<string, unknown> }> },
);

const mockUsersData = vi.hoisted(() => ({
  data: { id: "admin1" },
}));

// ---------------------------------------------------------------------------
// vi.mock() — module-level intercepts
// ---------------------------------------------------------------------------

vi.mock("@/backend/modules/notifications", () => ({
  insertNotificationIdempotent: mockInsertNotificationIdempotent,
}));

vi.mock("@/backend/modules/ai-engine", () => ({
  sumMonthlyCosts: mockSumMonthlyCosts,
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/backend/platform/supabase", () => {
  // We build a factory each time createServiceClient() is called so that the
  // from('orgs') and from('users') branches can return different data.
  const makeClient = () => ({
    from: vi.fn((table: string) => {
      if (table === "orgs") {
        return {
          select: vi.fn().mockResolvedValue(mockOrgsData),
        };
      }
      // table === "users"
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(mockUsersData),
      };
    }),
  });

  return {
    createServiceClient: vi.fn(makeClient),
    createServerClient: vi.fn(makeClient),
  };
});

// ---------------------------------------------------------------------------
// Import subject AFTER mocks (Vitest hoisting guarantees this order)
// ---------------------------------------------------------------------------

import { handleAiBudgetAggregation } from "../ai-budget-aggregation";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_PAYLOAD_THRESHOLD = {
  jobKey: "ai-budget-aggregation",
  dedupeId: "ai-budget-aggregation:2026-06-15",
  mode: "threshold" as const,
};

const VALID_PAYLOAD_MONTHLY_CLOSE = {
  jobKey: "ai-budget-aggregation",
  dedupeId: "ai-budget-aggregation:2026-06-15:close",
  mode: "monthly-close" as const,
};

// ---------------------------------------------------------------------------
// beforeEach — reset all mocks to safe defaults
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: single org with $100 budget
  mockOrgsData.data = [{ id: "org1", settings: { ai_budget_usd: 100 } }];

  // Default: admin user found
  mockUsersData.data = { id: "admin1" };

  // Default: no costs
  mockSumMonthlyCosts.mockResolvedValue({ totalUsd: 0, bySource: {} });

  // Default: notification inserted successfully
  mockInsertNotificationIdempotent.mockResolvedValue({
    row: { id: "notif-1" },
    created: true,
  });
});

// ---------------------------------------------------------------------------
// Threshold mode — ratio bands
// ---------------------------------------------------------------------------

describe("handleAiBudgetAggregation — threshold mode", () => {
  it("does NOT call insertNotificationIdempotent when ratio < 0.8 (totalUsd=79, budget=100)", async () => {
    // Arrange
    mockSumMonthlyCosts.mockResolvedValue({ totalUsd: 79, bySource: {} });

    // Act
    await handleAiBudgetAggregation(VALID_PAYLOAD_THRESHOLD);

    // Assert
    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
  });

  it("calls insertNotificationIdempotent with type 'ai.budget.over_80' when ratio == 0.8 (totalUsd=80, budget=100)", async () => {
    // Arrange
    mockSumMonthlyCosts.mockResolvedValue({ totalUsd: 80, bySource: {} });
    const expectedMonthUtc = new Date().toISOString().slice(0, 7);

    // Act
    await handleAiBudgetAggregation(VALID_PAYLOAD_THRESHOLD);

    // Assert
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledOnce();
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ai.budget.over_80",
        dedupeKey: expect.stringContaining(`ai-budget-over-80:org1:${expectedMonthUtc}`),
      }),
    );
  });

  it("calls insertNotificationIdempotent with type 'ai.budget.over_100' when ratio == 1.0 (totalUsd=100, budget=100)", async () => {
    // Arrange
    mockSumMonthlyCosts.mockResolvedValue({ totalUsd: 100, bySource: {} });
    const expectedMonthUtc = new Date().toISOString().slice(0, 7);

    // Act
    await handleAiBudgetAggregation(VALID_PAYLOAD_THRESHOLD);

    // Assert
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledOnce();
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ai.budget.over_100",
        dedupeKey: expect.stringContaining(`ai-budget-over-100:org1:${expectedMonthUtc}`),
      }),
    );
  });

  it("calls over_100 (NOT over_80) when ratio > 1.0 (totalUsd=150, budget=100)", async () => {
    // Arrange
    mockSumMonthlyCosts.mockResolvedValue({ totalUsd: 150, bySource: {} });

    // Act
    await handleAiBudgetAggregation(VALID_PAYLOAD_THRESHOLD);

    // Assert — only over_100 is fired, never over_80
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledOnce();
    const callArg = mockInsertNotificationIdempotent.mock.calls[0][0] as {
      type: string;
    };
    expect(callArg.type).toBe("ai.budget.over_100");
    const over80Calls = mockInsertNotificationIdempotent.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === "ai.budget.over_80",
    );
    expect(over80Calls).toHaveLength(0);
  });

  it("does NOT call insertNotificationIdempotent when settings has no ai_budget_usd (budget absent)", async () => {
    // Arrange: org with no budget set
    mockOrgsData.data = [{ id: "org1", settings: {} }];
    mockSumMonthlyCosts.mockResolvedValue({ totalUsd: 200, bySource: {} });

    // Act
    await handleAiBudgetAggregation(VALID_PAYLOAD_THRESHOLD);

    // Assert
    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
  });

  it("does NOT call insertNotificationIdempotent when ai_budget_usd is zero", async () => {
    // Arrange: budget explicitly set to 0 (treated as missing)
    mockOrgsData.data = [{ id: "org1", settings: { ai_budget_usd: 0 } }];
    mockSumMonthlyCosts.mockResolvedValue({ totalUsd: 50, bySource: {} });

    // Act
    await handleAiBudgetAggregation(VALID_PAYLOAD_THRESHOLD);

    // Assert
    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Idempotency — same dedupeKey on repeated invocations
// ---------------------------------------------------------------------------

describe("handleAiBudgetAggregation — idempotency", () => {
  it("produces the same dedupeKey on both invocations and does not throw", async () => {
    // Arrange
    mockSumMonthlyCosts.mockResolvedValue({ totalUsd: 80, bySource: {} });
    const expectedMonthUtc = new Date().toISOString().slice(0, 7);
    const expectedDedupeKey = `ai-budget-over-80:org1:${expectedMonthUtc}`;

    // Act — run handler twice with the same payload
    await handleAiBudgetAggregation(VALID_PAYLOAD_THRESHOLD);
    await handleAiBudgetAggregation(VALID_PAYLOAD_THRESHOLD);

    // Assert — both calls use the same dedupeKey (actual dedup lives in the DB via UNIQUE constraint)
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledTimes(2);
    const firstCallDedupeKey = (
      mockInsertNotificationIdempotent.mock.calls[0][0] as { dedupeKey: string }
    ).dedupeKey;
    const secondCallDedupeKey = (
      mockInsertNotificationIdempotent.mock.calls[1][0] as { dedupeKey: string }
    ).dedupeKey;

    expect(firstCallDedupeKey).toBe(expectedDedupeKey);
    expect(secondCallDedupeKey).toBe(expectedDedupeKey);
  });
});

// ---------------------------------------------------------------------------
// Monthly-close mode
// ---------------------------------------------------------------------------

describe("handleAiBudgetAggregation — monthly-close mode", () => {
  it("calls insertNotificationIdempotent with type 'ai.budget.monthly_close' and prev-month dedupeKey", async () => {
    // Arrange
    mockSumMonthlyCosts.mockResolvedValue({ totalUsd: 55, bySource: {} });

    // Compute the expected previous month (same logic as the job)
    const now = new Date();
    const prevDate = new Date(now);
    prevDate.setUTCDate(1); // pin day 1 first (avoid 29-31 rollover) — mirrors the job
    prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
    const expectedPrevMonth = prevDate.toISOString().slice(0, 7);

    // Act
    await handleAiBudgetAggregation(VALID_PAYLOAD_MONTHLY_CLOSE);

    // Assert
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledOnce();
    expect(mockInsertNotificationIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ai.budget.monthly_close",
        dedupeKey: `ai-budget-monthly-close:org1:${expectedPrevMonth}`,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Invalid payload
// ---------------------------------------------------------------------------

describe("handleAiBudgetAggregation — invalid payload", () => {
  it("returns without calling any side-effect when payload is empty object", async () => {
    // Act
    await handleAiBudgetAggregation({});

    // Assert
    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
    expect(mockSumMonthlyCosts).not.toHaveBeenCalled();
  });

  it("returns without calling any side-effect when jobKey is wrong", async () => {
    // Act
    await handleAiBudgetAggregation({
      jobKey: "something-else",
      dedupeId: "xyz",
    });

    // Assert
    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
    expect(mockSumMonthlyCosts).not.toHaveBeenCalled();
  });

  it("returns without calling any side-effect when dedupeId is missing", async () => {
    // Act
    await handleAiBudgetAggregation({
      jobKey: "ai-budget-aggregation",
      // dedupeId intentionally omitted
    });

    // Assert
    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
    expect(mockSumMonthlyCosts).not.toHaveBeenCalled();
  });

  it("returns without throwing when payload is null", async () => {
    // Act + Assert
    await expect(handleAiBudgetAggregation(null)).resolves.toBeUndefined();
    expect(mockInsertNotificationIdempotent).not.toHaveBeenCalled();
  });
});
