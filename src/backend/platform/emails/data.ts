/**
 * Structured email data — the typed payload rich transactional templates need
 * beyond the generic notification title/body (DOC-73 §2/§3).
 *
 * Flow: notifications.buildEmailData → QStash job payload → deliver-notification
 * → renderTransactionalEmail routes by `kind` to a dedicated template. Validated
 * with Zod at the job boundary (the payload crosses a queue, so it is untrusted).
 *
 * Server-only: never imported from a client bundle.
 */

import { z } from "zod";
import type { Locale } from "./i18n";

// ---------------------------------------------------------------------------
// Schemas (discriminated by `kind`) — transport-validated
// ---------------------------------------------------------------------------

export const WelcomeEmailDataSchema = z.object({
  kind: z.literal("welcome"),
  clientName: z.string().nullable(),
  /** E.164 phone the client registered with — their login credential today. */
  phone: z.string().nullable(),
});

export const ContractReadyEmailDataSchema = z.object({
  kind: z.literal("contract-ready"),
  clientName: z.string().nullable(),
  phone: z.string().nullable(),
  serviceName: z.string(),
  totalCents: z.number(),
  downpaymentCents: z.number(),
  installmentCount: z.number(),
  frequency: z.string(),
});

export const PaymentReceiptEmailDataSchema = z.object({
  kind: z.literal("payment-receipt"),
  clientName: z.string().nullable(),
  amountCents: z.number(),
  /** Raw payment method ("zelle" | "stripe"). */
  method: z.string(),
  autopay: z.boolean(),
  cardLast4: z.string().nullable(),
  isDownpayment: z.boolean(),
  /** Installment number (0 = down payment); null when unknown. */
  installmentNumber: z.number().nullable(),
  installmentCount: z.number(),
  paidCount: z.number(),
  remainingCount: z.number(),
  remainingAmountCents: z.number(),
  nextDueDate: z.string().nullable(),
  nextDueAmountCents: z.number().nullable(),
  caseNumber: z.string().nullable(),
});

export const EmailDataSchema = z.discriminatedUnion("kind", [
  WelcomeEmailDataSchema,
  ContractReadyEmailDataSchema,
  PaymentReceiptEmailDataSchema,
]);

export type WelcomeEmailData = z.infer<typeof WelcomeEmailDataSchema>;
export type ContractReadyEmailData = z.infer<typeof ContractReadyEmailDataSchema>;
export type PaymentReceiptEmailData = z.infer<typeof PaymentReceiptEmailDataSchema>;
export type EmailData = z.infer<typeof EmailDataSchema>;

// ---------------------------------------------------------------------------
// Shared formatters (email-safe, no external deps)
// ---------------------------------------------------------------------------

/** Formats integer cents as USD ("$1,234.56"). All plans are USD (DOC-44). */
export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number.isFinite(cents) ? cents : 0) / 100);
}

/** Human label for the payment method (autopay wins, then card/Zelle). */
export function paymentMethodLabel(
  data: { method: string; autopay: boolean; cardLast4: string | null },
  locale: Locale,
): string {
  if (data.autopay) {
    const base = locale === "en" ? "Automatic card payment" : "Cobro automático";
    return data.cardLast4 ? `${base} (•••• ${data.cardLast4})` : base;
  }
  if (data.method === "zelle") return "Zelle";
  if (data.method === "stripe") {
    const card = locale === "en" ? "Card" : "Tarjeta";
    return data.cardLast4 ? `${card} •••• ${data.cardLast4}` : card;
  }
  return data.method;
}

/** Formats a YYYY-MM-DD date string to a readable localized date (UTC-anchored). */
export function formatDueDate(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** Human label for a payment-plan frequency. */
export function frequencyLabel(frequency: string, locale: Locale): string {
  if (frequency === "weekly") return locale === "en" ? "weekly" : "semanal";
  if (frequency === "biweekly") return locale === "en" ? "biweekly" : "quincenal";
  return locale === "en" ? "monthly" : "mensual";
}
