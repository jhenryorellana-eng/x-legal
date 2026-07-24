/**
 * Payment-receipt PDF — the attachment that travels with the receipt email.
 *
 * Deliberately a dedicated HTML builder instead of reusing the react-email
 * markup: mupdf honors only a small CSS subset (no nested email tables, no
 * media queries) and never fetches remote assets (the BrandLayout logo is a
 * URL), so the email HTML would render broken. Same precedent as
 * buildCoverHtml/renderCoverPdf in platform/pdf.ts.
 *
 * Content mirrors PaymentReceiptEmail via the shared formatters in ./data so
 * email and PDF can never disagree on amounts, method or dates.
 */

import {
  formatDueDate,
  formatUsd,
  paymentMethodLabel,
  type PaymentReceiptEmailData,
} from "./data";
import type { Locale } from "./i18n";
import { htmlToPdf } from "../pdf";

const NAVY = "#0d2d52";
const ACCENT = "#1a6ee0";
const MUTED = "#5a6675";
const BORDER = "#d9e0e9";

const COPY = {
  es: {
    docTitle: "Comprobante de pago",
    org: "UsaLatinoPrime — Servicios de inmigración",
    issued: "Emitido",
    client: "Cliente",
    amountLabel: "Monto pagado",
    method: "Método de pago",
    installmentLabel: "Cuota",
    downpaymentLabel: "Cuota inicial",
    caseLabel: "Caso",
    progress: (paid: number, total: number) => `${paid} de ${total} cuotas pagadas`,
    remaining: (n: number, amount: string) =>
      n === 1 ? `Saldo pendiente: 1 cuota (${amount})` : `Saldo pendiente: ${n} cuotas (${amount})`,
    nextDue: (date: string) => `Próximo vencimiento: ${date}`,
    done: "Plan de pagos completado.",
    footer:
      "Este comprobante confirma el pago registrado en tu plan. Consérvalo para tus registros.",
  },
  en: {
    docTitle: "Payment receipt",
    org: "UsaLatinoPrime — Immigration services",
    issued: "Issued",
    client: "Client",
    amountLabel: "Amount paid",
    method: "Payment method",
    installmentLabel: "Installment",
    downpaymentLabel: "Down payment",
    caseLabel: "Case",
    progress: (paid: number, total: number) => `${paid} of ${total} installments paid`,
    remaining: (n: number, amount: string) =>
      n === 1 ? `Outstanding: 1 installment (${amount})` : `Outstanding: ${n} installments (${amount})`,
    nextDue: (date: string) => `Next due date: ${date}`,
    done: "Payment plan completed.",
    footer: "This receipt confirms the payment recorded on your plan. Keep it for your records.",
  },
} as const;

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

function issuedLabel(issuedAt: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(issuedAt);
}

/**
 * Pure HTML builder for the receipt PDF (US Letter, mupdf-safe subset:
 * plain divs, inline styles, no remote assets). Testable without mupdf.
 */
export function buildPaymentReceiptPdfHtml(
  data: PaymentReceiptEmailData,
  locale: Locale,
  issuedAt: Date = new Date(),
): string {
  const t = COPY[locale];
  const installmentValue = data.isDownpayment
    ? t.downpaymentLabel
    : data.installmentNumber != null
      ? `${data.installmentNumber} / ${data.installmentCount}`
      : `— / ${data.installmentCount}`;
  const nextDue = formatDueDate(data.nextDueDate, locale);

  const row = (label: string, value: string) =>
    `<tr>
      <td style="padding:6pt 0;color:${MUTED};font-size:11pt;width:40%">${esc(label)}</td>
      <td style="padding:6pt 0;color:#1c2430;font-size:11pt;font-weight:bold">${esc(value)}</td>
    </tr>`;

  return `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;margin:0;padding:48pt 54pt;color:#1c2430">
    <div style="border-bottom:2pt solid ${NAVY};padding-bottom:10pt">
      <div style="font-size:20pt;font-weight:bold;color:${NAVY}">${esc(t.docTitle)}</div>
      <div style="font-size:10pt;color:${MUTED};margin-top:4pt">${esc(t.org)}</div>
    </div>

    <div style="margin-top:14pt;font-size:10pt;color:${MUTED}">
      ${esc(t.issued)}: ${esc(issuedLabel(issuedAt, locale))}
      ${data.clientName ? ` &nbsp;·&nbsp; ${esc(t.client)}: ${esc(data.clientName)}` : ""}
    </div>

    <div style="margin-top:22pt;background-color:${NAVY};padding:16pt;text-align:center">
      <div style="font-size:10pt;color:#c9d6ea">${esc(t.amountLabel)}</div>
      <div style="font-size:26pt;font-weight:bold;color:#ffffff;margin-top:4pt">${esc(formatUsd(data.amountCents))}</div>
    </div>

    <table style="width:100%;margin-top:18pt;border-collapse:collapse">
      ${row(t.method, paymentMethodLabel(data, locale))}
      ${row(t.installmentLabel, installmentValue)}
      ${data.caseNumber ? row(t.caseLabel, data.caseNumber) : ""}
    </table>

    <div style="margin-top:18pt;border-top:1pt solid ${BORDER};padding-top:12pt">
      <div style="font-size:11pt;font-weight:bold;color:${NAVY}">${esc(t.progress(data.paidCount, data.installmentCount))}</div>
      <div style="font-size:11pt;color:#1c2430;margin-top:6pt">
        ${
          data.remainingCount > 0
            ? esc(t.remaining(data.remainingCount, formatUsd(data.remainingAmountCents))) +
              (nextDue ? `<br>${esc(t.nextDue(nextDue))}` : "")
            : `<span style="color:${ACCENT};font-weight:bold">${esc(t.done)}</span>`
        }
      </div>
    </div>

    <div style="margin-top:30pt;border-top:1pt solid ${BORDER};padding-top:10pt;font-size:9pt;color:${MUTED}">
      ${esc(t.footer)}
    </div>
  </body></html>`;
}

/** Renders the receipt PDF bytes (mupdf via platform/pdf.ts htmlToPdf). */
export async function renderPaymentReceiptPdf(
  data: PaymentReceiptEmailData,
  locale: Locale,
  issuedAt: Date = new Date(),
): Promise<Uint8Array> {
  return htmlToPdf(buildPaymentReceiptPdfHtml(data, locale, issuedAt));
}

/**
 * Attachment filename: "comprobante-U26-000107-cuota-3.pdf",
 * "comprobante-U26-000107-inicial.pdf", or "comprobante-pago.pdf" when the
 * case number is unknown. Case number is sanitized for filesystem safety.
 */
export function receiptPdfFilename(data: PaymentReceiptEmailData): string {
  const caseSlug = data.caseNumber?.replace(/[^A-Za-z0-9-]/g, "") ?? null;
  const part = data.isDownpayment
    ? "inicial"
    : data.installmentNumber != null
      ? `cuota-${data.installmentNumber}`
      : null;
  const pieces = ["comprobante", caseSlug, part].filter(Boolean);
  if (pieces.length === 1) return "comprobante-pago.pdf";
  return `${pieces.join("-")}.pdf`;
}
