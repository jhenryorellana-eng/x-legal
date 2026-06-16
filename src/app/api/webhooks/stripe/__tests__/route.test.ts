/**
 * Stripe webhook route — unit tests for idempotency + retry behavior (HIGH-1).
 *
 * Key invariants under test:
 *   - "fresh": first delivery → runs handler → marks processed → 200
 *   - "duplicate": processed_at set → skips handler → 200 (no re-run)
 *   - "retry": handler threw on first delivery (processed_at null) → re-runs on second delivery
 *     This is the critical bug that was fixed: previously a 23505 always returned 200
 *     without checking processed_at, so failed handlers were never retried.
 *
 * The route is tested via direct function import (not HTTP fetch) because
 * Next.js App Router route handlers are just async functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockStripeVerify = vi.hoisted(() => vi.fn());
const mockClaimWebhookEvent = vi.hoisted(() => vi.fn());
const mockMarkWebhookEventProcessed = vi.hoisted(() => vi.fn());
const mockHandleStripeEvent = vi.hoisted(() => vi.fn());
const mockServiceClient = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
}));

vi.mock("@/backend/platform/stripe", () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: mockStripeVerify,
    },
  }),
}));

vi.mock("@/backend/platform/webhook-events", () => ({
  claimWebhookEvent: mockClaimWebhookEvent,
  markWebhookEventProcessed: mockMarkWebhookEventProcessed,
}));

vi.mock("@/backend/modules/billing", () => ({
  handleStripeEvent: mockHandleStripeEvent,
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: () => mockServiceClient,
}));

vi.mock("@/backend/platform/env", () => ({
  providerEnv: vi.fn(() => ({ STRIPE_WEBHOOK_SECRET: "whsec_test" })),
  env: {},
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import AFTER mocks — the test imports the unit under test; boundaries governs
// production architecture, not test files importing their own route handler.
// eslint-disable-next-line boundaries/element-types
import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STRIPE_SIG = "t=1234,v1=abc";
const EVENT_ID = "evt_test_123";
const ORG_ID = "44444444-4444-4444-8444-444444444444";

function makeRequest(body = "{}"): Request {
  return new Request("https://example.com/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": STRIPE_SIG, "content-type": "application/json" },
    body,
  });
}

function makeStripeEvent(overrides?: Record<string, unknown>) {
  return {
    id: EVENT_ID,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test",
        payment_status: "paid",
        metadata: { org_id: ORG_ID, installment_id: "inst-1", case_id: "case-1" },
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkWebhookEventProcessed.mockResolvedValue(undefined);
  mockHandleStripeEvent.mockResolvedValue(undefined);
  // Default: signature valid
  mockStripeVerify.mockReturnValue(makeStripeEvent());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/webhooks/stripe — idempotency + retry (HIGH-1)", () => {
  it("fresh delivery: runs handler and marks processed → 200", async () => {
    mockClaimWebhookEvent.mockResolvedValue("fresh");

    const res = await POST(makeRequest() as unknown as import("next/server").NextRequest);

    expect(res.status).toBe(200);
    expect(mockHandleStripeEvent).toHaveBeenCalledTimes(1);
    expect(mockMarkWebhookEventProcessed).toHaveBeenCalledWith("stripe", EVENT_ID);

    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it("duplicate delivery (processed_at set): skips handler → 200", async () => {
    mockClaimWebhookEvent.mockResolvedValue("duplicate");

    const res = await POST(makeRequest() as unknown as import("next/server").NextRequest);

    expect(res.status).toBe(200);
    // Handler must NOT be called for a duplicate
    expect(mockHandleStripeEvent).not.toHaveBeenCalled();
    expect(mockMarkWebhookEventProcessed).not.toHaveBeenCalled();

    const body = await res.json() as Record<string, unknown>;
    expect(body.duplicate).toBe(true);
  });

  it("retry delivery (prior attempt failed, processed_at null): re-runs handler → 200", async () => {
    // This is the critical regression fix: previously 23505 → 200 without checking
    // processed_at, so a crashed handler was never retried.
    // Now: claim="retry" (prior attempt had no processed_at) → re-run handler.
    mockClaimWebhookEvent.mockResolvedValue("retry");

    const res = await POST(makeRequest() as unknown as import("next/server").NextRequest);

    expect(res.status).toBe(200);
    // Handler IS called on retry
    expect(mockHandleStripeEvent).toHaveBeenCalledTimes(1);
    // And marked processed after success
    expect(mockMarkWebhookEventProcessed).toHaveBeenCalledWith("stripe", EVENT_ID);
  });

  it("handler throws on delivery → 500, processed NOT marked (enables retry)", async () => {
    mockClaimWebhookEvent.mockResolvedValue("fresh");
    mockHandleStripeEvent.mockRejectedValue(new Error("handler crash"));

    const res = await POST(makeRequest() as unknown as import("next/server").NextRequest);

    expect(res.status).toBe(500);
    // CRITICAL: must NOT mark processed when handler fails
    // (so next Stripe delivery gets claim="retry" and re-runs)
    expect(mockMarkWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it("signature failure → 400, handler not called", async () => {
    mockStripeVerify.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });

    const res = await POST(makeRequest() as unknown as import("next/server").NextRequest);

    expect(res.status).toBe(400);
    expect(mockHandleStripeEvent).not.toHaveBeenCalled();
    expect(mockClaimWebhookEvent).not.toHaveBeenCalled();
  });

  it("missing stripe-signature header → 400", async () => {
    const req = new Request("https://example.com/api/webhooks/stripe", {
      method: "POST",
      body: "{}",
    });

    const res = await POST(req as unknown as import("next/server").NextRequest);

    expect(res.status).toBe(400);
    expect(mockHandleStripeEvent).not.toHaveBeenCalled();
  });

  it("event with no org_id: dispatches handler without idempotency barrier (MED-2)", async () => {
    mockStripeVerify.mockReturnValue({
      ...makeStripeEvent(),
      data: {
        object: {
          id: "cs_no_org",
          payment_status: "paid",
          metadata: {}, // no org_id
        },
      },
    });

    const res = await POST(makeRequest() as unknown as import("next/server").NextRequest);

    expect(res.status).toBe(200);
    // claimWebhookEvent NOT called (no org_id to register with)
    expect(mockClaimWebhookEvent).not.toHaveBeenCalled();
    // Handler IS called (still processes the event)
    expect(mockHandleStripeEvent).toHaveBeenCalledTimes(1);
  });
});
