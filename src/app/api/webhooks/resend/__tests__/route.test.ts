/**
 * Resend webhook route — signature + dispatch + idempotency tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockVerify = vi.hoisted(() => vi.fn());
vi.mock("svix", () => ({
  Webhook: class {
    verify = mockVerify;
  },
}));

vi.mock("@/backend/platform/env", () => ({
  providerEnv: () => ({ RESEND_WEBHOOK_SECRET: "whsec_test" }),
}));
vi.mock("@/backend/platform/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const mockWebhookEvents = vi.hoisted(() => ({
  claimWebhookEvent: vi.fn(),
  markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
  markWebhookEventError: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/backend/platform/webhook-events", () => mockWebhookEvents);

const mockCampaigns = vi.hoisted(() => ({
  applyResendEvent: vi.fn().mockResolvedValue(undefined),
  resolveRecipientOrg: vi.fn(),
}));
vi.mock("@/backend/modules/campaigns", () => mockCampaigns);

// eslint-disable-next-line boundaries/element-types -- test imports the route under test
import { POST } from "../route";

function makeRequest(body: object): Request {
  return new Request("https://app/api/webhooks/resend", {
    method: "POST",
    headers: { "svix-id": "evt_1", "svix-timestamp": "1", "svix-signature": "v1,sig" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resend webhook route", () => {
  it("returns 401 on invalid signature", async () => {
    mockVerify.mockImplementation(() => {
      throw new Error("invalid signature");
    });
    const res = await POST(makeRequest({ type: "email.bounced" }) as never);
    expect(res.status).toBe(401);
    expect(mockCampaigns.applyResendEvent).not.toHaveBeenCalled();
  });

  it("dispatches a verified bounce and marks processed (org resolved)", async () => {
    const payload = { type: "email.bounced", created_at: "2026-06-16T00:00:00Z", data: { to: ["u1@x.com"] } };
    mockVerify.mockReturnValue(payload);
    mockCampaigns.resolveRecipientOrg.mockResolvedValue("org-1");
    mockWebhookEvents.claimWebhookEvent.mockResolvedValue("fresh");

    const res = await POST(makeRequest(payload) as never);
    expect(res.status).toBe(200);
    expect(mockCampaigns.applyResendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "email.bounced", email: "u1@x.com" }),
    );
    expect(mockWebhookEvents.markWebhookEventProcessed).toHaveBeenCalledWith("resend", "evt_1");
  });

  it("skips duplicate deliveries", async () => {
    const payload = { type: "email.complained", data: { to: ["u1@x.com"] } };
    mockVerify.mockReturnValue(payload);
    mockCampaigns.resolveRecipientOrg.mockResolvedValue("org-1");
    mockWebhookEvents.claimWebhookEvent.mockResolvedValue("duplicate");

    const res = await POST(makeRequest(payload) as never);
    const json = await res.json();
    expect(json.duplicate).toBe(true);
    expect(mockCampaigns.applyResendEvent).not.toHaveBeenCalled();
  });
});
