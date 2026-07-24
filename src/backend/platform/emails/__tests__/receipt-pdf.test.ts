/**
 * receipt-pdf — pure HTML builder + filename tests (Feature "comprobante PDF").
 *
 * Repo pattern: only the pure builder is tested; the mupdf render itself is not
 * (same as buildCoverHtml — deterministic HTML in, bytes out).
 */

import { describe, it, expect } from "vitest";
import { buildPaymentReceiptPdfHtml, receiptPdfFilename } from "../receipt-pdf";
import type { PaymentReceiptEmailData } from "../data";

const ISSUED = new Date("2026-07-24T00:00:00Z");

const base: PaymentReceiptEmailData = {
  kind: "payment-receipt",
  clientName: "María González",
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

describe("buildPaymentReceiptPdfHtml", () => {
  it("renders amount, case, installment, method and progress (es)", () => {
    const html = buildPaymentReceiptPdfHtml(base, "es", ISSUED);
    expect(html).toContain("Comprobante de pago");
    expect(html).toContain("$350.00");
    expect(html).toContain("U26-000107");
    expect(html).toContain("3 / 6");
    expect(html).toContain("Zelle");
    expect(html).toContain("3 de 6 cuotas pagadas");
    expect(html).toContain("María González");
    // Next due date localized in Spanish
    expect(html).toContain("15 de agosto de 2026");
  });

  it("renders in English when locale is en", () => {
    const html = buildPaymentReceiptPdfHtml(base, "en", ISSUED);
    expect(html).toContain("Payment receipt");
    expect(html).toContain("3 of 6 installments paid");
    expect(html).toContain("August 15, 2026");
  });

  it("labels the down payment and the completed plan", () => {
    const html = buildPaymentReceiptPdfHtml(
      {
        ...base,
        isDownpayment: true,
        installmentNumber: 0,
        paidCount: 6,
        remainingCount: 0,
        remainingAmountCents: 0,
        nextDueDate: null,
      },
      "es",
      ISSUED,
    );
    expect(html).toContain("Cuota inicial");
    expect(html).toContain("Plan de pagos completado.");
    expect(html).not.toContain("Saldo pendiente");
  });

  it("shows autopay card label via the shared formatter", () => {
    const html = buildPaymentReceiptPdfHtml(
      { ...base, method: "stripe", autopay: true, cardLast4: "4242" },
      "es",
      ISSUED,
    );
    expect(html).toContain("Cobro automático (•••• 4242)");
  });

  it("escapes HTML in client-provided values", () => {
    const html = buildPaymentReceiptPdfHtml(
      { ...base, clientName: "Eve <script>alert(1)</script>" },
      "es",
      ISSUED,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("omits the case row when caseNumber is null", () => {
    const html = buildPaymentReceiptPdfHtml({ ...base, caseNumber: null }, "es", ISSUED);
    expect(html).not.toContain("Caso");
  });
});

describe("receiptPdfFilename", () => {
  it("names a regular installment receipt", () => {
    expect(receiptPdfFilename(base)).toBe("comprobante-U26-000107-cuota-3.pdf");
  });

  it("names a down payment receipt", () => {
    expect(receiptPdfFilename({ ...base, isDownpayment: true, installmentNumber: 0 })).toBe(
      "comprobante-U26-000107-inicial.pdf",
    );
  });

  it("falls back when the case number is unknown", () => {
    expect(receiptPdfFilename({ ...base, caseNumber: null, installmentNumber: null })).toBe(
      "comprobante-pago.pdf",
    );
  });

  it("keeps the installment part without a case number", () => {
    expect(receiptPdfFilename({ ...base, caseNumber: null })).toBe("comprobante-cuota-3.pdf");
  });

  it("sanitizes unsafe characters out of the case number", () => {
    expect(receiptPdfFilename({ ...base, caseNumber: "U26/00..0107" })).toBe(
      "comprobante-U26000107-cuota-3.pdf",
    );
  });
});
