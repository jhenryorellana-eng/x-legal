/**
 * deliver-notification job — push channel unit tests (F7-Ola7b §5.3 / DOC-24).
 *
 * Covers: read_at re-verification (grace suppression), stale endpoint cleanup,
 * and the no-subscriptions silent skip.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindNotificationById = vi.hoisted(() => vi.fn());
const mockFindUserById = vi.hoisted(() => vi.fn());
const mockListPushSubscriptions = vi.hoisted(() => vi.fn());
const mockDeletePushSubscriptionByEndpoint = vi.hoisted(() => vi.fn());
const mockSendPush = vi.hoisted(() => vi.fn());
// Minimal stand-in for EmailDataSchema (a zod schema) — the job composes it into
// its payload schema via `.optional()`; validation of emailData is not under test.
const mockEmailDataSchema = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require("zod");
  return z.any();
});

vi.mock("@/backend/modules/notifications", () => ({
  findNotificationById: mockFindNotificationById,
  findUserById: mockFindUserById,
  listPushSubscriptions: mockListPushSubscriptions,
  deletePushSubscriptionByEndpoint: mockDeletePushSubscriptionByEndpoint,
}));

vi.mock("@/backend/platform/webpush", () => ({
  sendPush: mockSendPush,
}));

vi.mock("@/backend/platform/resend", () => ({
  sendTransactional: vi.fn(),
}));

vi.mock("@/backend/platform/emails", () => ({
  renderTransactionalEmail: vi.fn(),
  EmailDataSchema: mockEmailDataSchema,
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { handleDeliverNotification } from "../deliver-notification";

const NOTIF_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "11111111-1111-4111-8111-111111111222";

const baseNotification = {
  id: NOTIF_ID,
  user_id: USER_ID,
  type: "message.received",
  title_i18n: { es: "Nuevo mensaje", en: "New message" },
  body_i18n: { es: "Tienes un mensaje", en: "You have a message" },
  action_url: "/caso/abc",
  read_at: null,
};

const SUB = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUserById.mockResolvedValue({ id: USER_ID, locale: "es", email: null, emailBouncedAt: null, kind: "client" });
  mockListPushSubscriptions.mockResolvedValue([SUB]);
  mockSendPush.mockResolvedValue({ stale: false });
  mockDeletePushSubscriptionByEndpoint.mockResolvedValue(undefined);
});

describe("deliver-notification push channel", () => {
  it("sends a push to each subscription with the localized payload", async () => {
    mockFindNotificationById.mockResolvedValue(baseNotification);
    await handleDeliverNotification({ channel: "push", notificationId: NOTIF_ID });

    expect(mockSendPush).toHaveBeenCalledTimes(1);
    const [sub, payload] = mockSendPush.mock.calls[0];
    expect(sub.endpoint).toBe(SUB.endpoint);
    expect(payload.title).toBe("Nuevo mensaje"); // es locale
    expect(payload.url).toBe("/caso/abc");
    expect(payload.tag).toBe("message.received");
    expect(mockDeletePushSubscriptionByEndpoint).not.toHaveBeenCalled();
  });

  it("suppresses push when the notification was already read (grace, DOC-46 §5.3.2)", async () => {
    mockFindNotificationById.mockResolvedValue({ ...baseNotification, read_at: new Date().toISOString() });
    await handleDeliverNotification({ channel: "push", notificationId: NOTIF_ID });
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("skips silently when the user has no subscriptions (RF-TRX-010 CA4)", async () => {
    mockFindNotificationById.mockResolvedValue(baseNotification);
    mockListPushSubscriptions.mockResolvedValue([]);
    await handleDeliverNotification({ channel: "push", notificationId: NOTIF_ID });
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("deletes a stale subscription (404/410) returned by sendPush", async () => {
    mockFindNotificationById.mockResolvedValue(baseNotification);
    mockSendPush.mockResolvedValue({ stale: true });
    await handleDeliverNotification({ channel: "push", notificationId: NOTIF_ID });
    expect(mockDeletePushSubscriptionByEndpoint).toHaveBeenCalledWith(SUB.endpoint);
  });

  it("continues to other endpoints when one push throws", async () => {
    mockFindNotificationById.mockResolvedValue(baseNotification);
    mockListPushSubscriptions.mockResolvedValue([
      SUB,
      { endpoint: "https://push.example/def", keys: { p256dh: "p2", auth: "a2" } },
    ]);
    mockSendPush.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ stale: false });
    await handleDeliverNotification({ channel: "push", notificationId: NOTIF_ID });
    expect(mockSendPush).toHaveBeenCalledTimes(2); // did not abort after the first threw
  });
});
