/**
 * deliver-notification job — email channel: payment-receipt PDF attachment.
 *
 * Covers: attachment present for payment-receipt emailData, absent for other
 * kinds, and the degraded path (PDF render fails → email still sent, no
 * attachment).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindNotificationById = vi.hoisted(() => vi.fn());
const mockSendTransactional = vi.hoisted(() => vi.fn());
const mockRenderTransactionalEmail = vi.hoisted(() => vi.fn());
const mockRenderPaymentReceiptPdf = vi.hoisted(() => vi.fn());
const mockReceiptPdfFilename = vi.hoisted(() => vi.fn());
const mockEmailDataSchema = vi.hoisted(() => {
  const { z } = require("zod");
  return z.any();
});

vi.mock("@/backend/modules/notifications", () => ({
  findNotificationById: mockFindNotificationById,
  findUserById: vi.fn(),
  listPushSubscriptions: vi.fn(),
  deletePushSubscriptionByEndpoint: vi.fn(),
}));

vi.mock("@/backend/platform/webpush", () => ({ sendPush: vi.fn() }));

vi.mock("@/backend/platform/resend", () => ({
  sendTransactional: mockSendTransactional,
}));

vi.mock("@/backend/platform/emails", () => ({
  renderTransactionalEmail: mockRenderTransactionalEmail,
  EmailDataSchema: mockEmailDataSchema,
  pickLocale: (l: string | null | undefined) => (l === "en" ? "en" : "es"),
  renderPaymentReceiptPdf: mockRenderPaymentReceiptPdf,
  receiptPdfFilename: mockReceiptPdfFilename,
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { handleDeliverNotification } from "../deliver-notification";

const NOTIF_ID = "22222222-2222-4222-8222-222222222222";

const notification = {
  id: NOTIF_ID,
  user_id: "22222222-2222-4222-8222-222222222333",
  type: "installment.paid",
  title_i18n: { es: "Recibo de tu pago", en: "Your payment receipt" },
  body_i18n: { es: "", en: "" },
  action_url: "/pagos",
  read_at: null,
};

const receiptData = {
  kind: "payment-receipt",
  clientName: "María",
  amountCents: 35000,
  method: "zelle",
  autopay: false,
  cardLast4: null,
  isDownpayment: false,
  installmentNumber: 3,
  installmentCount: 6,
  paidCount: 3,
  remainingCount: 3,
  remainingAmountCents: 105000,
  nextDueDate: "2026-08-15",
  nextDueAmountCents: 35000,
  caseNumber: "U26-000107",
};

function emailPayload(emailData?: unknown) {
  return {
    channel: "email",
    notificationId: NOTIF_ID,
    templateKey: "installment-paid",
    recipientEmail: "cliente@example.com",
    locale: "es",
    ...(emailData !== undefined && { emailData }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindNotificationById.mockResolvedValue(notification);
  mockRenderTransactionalEmail.mockResolvedValue({
    subject: "Recibo",
    html: "<html></html>",
    text: "Recibo",
  });
  mockSendTransactional.mockResolvedValue({ id: "email-1" });
  mockRenderPaymentReceiptPdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockReceiptPdfFilename.mockReturnValue("comprobante-U26-000107-cuota-3.pdf");
});

describe("deliver-notification email channel — receipt PDF attachment", () => {
  it("attaches the receipt PDF for payment-receipt emailData", async () => {
    await handleDeliverNotification(emailPayload(receiptData));

    expect(mockRenderPaymentReceiptPdf).toHaveBeenCalledWith(receiptData, "es");
    expect(mockSendTransactional).toHaveBeenCalledTimes(1);
    const opts = mockSendTransactional.mock.calls[0][0];
    expect(opts.attachments).toHaveLength(1);
    expect(opts.attachments[0].filename).toBe("comprobante-U26-000107-cuota-3.pdf");
    expect(Buffer.isBuffer(opts.attachments[0].content)).toBe(true);
  });

  it("sends without attachments for non-receipt emailData", async () => {
    await handleDeliverNotification(
      emailPayload({ kind: "welcome", clientName: "María", phone: null }),
    );

    expect(mockRenderPaymentReceiptPdf).not.toHaveBeenCalled();
    expect(mockSendTransactional.mock.calls[0][0].attachments).toBeUndefined();
  });

  it("sends without attachments when there is no emailData at all", async () => {
    await handleDeliverNotification(emailPayload());

    expect(mockRenderPaymentReceiptPdf).not.toHaveBeenCalled();
    expect(mockSendTransactional.mock.calls[0][0].attachments).toBeUndefined();
  });

  it("still sends the email when the PDF render fails (degraded path)", async () => {
    mockRenderPaymentReceiptPdf.mockRejectedValue(new Error("mupdf exploded"));

    await handleDeliverNotification(emailPayload(receiptData));

    expect(mockSendTransactional).toHaveBeenCalledTimes(1);
    expect(mockSendTransactional.mock.calls[0][0].attachments).toBeUndefined();
  });
});
