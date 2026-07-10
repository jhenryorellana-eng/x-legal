/**
 * PaymentReceiptEmail — client receipt sent when a payment is confirmed
 * (DOC-73 §2 `installment-paid` / `downpayment-confirmed`). Covers all three
 * flows (Zelle, manual card, autopay) — they all funnel through
 * billing.applyPaymentSuccess. Shows amount, method, installment progress,
 * how many are left, and the next due date.
 */

import { Button, Column, Hr, Row, Section, Text } from "@react-email/components";
import * as React from "react";
import { BrandLayout } from "../BrandLayout";
import { COLORS } from "../theme";
import type { Locale } from "../i18n";
import {
  formatDueDate,
  formatUsd,
  paymentMethodLabel,
  type PaymentReceiptEmailData,
} from "../data";

const COPY = {
  es: {
    preview: "Confirmamos tu pago. ¡Gracias!",
    greeting: (name: string | null) => (name ? `Hola, ${name}:` : "Hola:"),
    title: "¡Pago recibido!",
    subtitle: "Confirmamos tu pago. Aquí está tu recibo.",
    amountLabel: "Monto pagado",
    method: "Método",
    installmentLabel: "Cuota",
    downpaymentLabel: "Cuota inicial",
    caseLabel: "Caso",
    progressTitle: "Progreso de tu plan",
    progressBody: (paid: number, total: number) => `${paid} de ${total} cuotas pagadas`,
    remaining: (n: number, amount: string) =>
      n === 1 ? `Te falta 1 cuota (${amount}).` : `Te faltan ${n} cuotas (${amount}).`,
    nextDue: (date: string) => `Próximo pago: ${date}.`,
    done: "¡Completaste todos tus pagos! 🎉 Gracias por tu confianza.",
    cta: "Ver mis pagos",
  },
  en: {
    preview: "Your payment is confirmed. Thank you!",
    greeting: (name: string | null) => (name ? `Hi ${name},` : "Hi,"),
    title: "Payment received!",
    subtitle: "Your payment is confirmed. Here's your receipt.",
    amountLabel: "Amount paid",
    method: "Method",
    installmentLabel: "Installment",
    downpaymentLabel: "Down payment",
    caseLabel: "Case",
    progressTitle: "Your plan progress",
    progressBody: (paid: number, total: number) => `${paid} of ${total} installments paid`,
    remaining: (n: number, amount: string) =>
      n === 1 ? `You have 1 installment left (${amount}).` : `You have ${n} installments left (${amount}).`,
    nextDue: (date: string) => `Next payment: ${date}.`,
    done: "You've completed all your payments! 🎉 Thank you for trusting us.",
    cta: "View my payments",
  },
} as const;

export interface PaymentReceiptEmailProps {
  locale: Locale;
  data: PaymentReceiptEmailData;
  /** Absolute link to the payments screen (from the notification action_url). */
  ctaUrl?: string;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ marginBottom: 6 }}>
      <Column style={{ width: "42%", verticalAlign: "top" }}>
        <Text style={{ margin: 0, fontSize: 14, color: COLORS.muted }}>{label}</Text>
      </Column>
      <Column>
        <Text style={{ margin: 0, fontSize: 14, fontWeight: 600, color: COLORS.text }}>
          {value}
        </Text>
      </Column>
    </Row>
  );
}

export function PaymentReceiptEmail({ locale, data, ctaUrl }: PaymentReceiptEmailProps) {
  const t = COPY[locale];
  const total = Math.max(data.installmentCount, 1);
  const pct = Math.min(100, Math.round((data.paidCount / total) * 100));
  const nextDue = formatDueDate(data.nextDueDate, locale);

  const installmentValue = data.isDownpayment
    ? t.downpaymentLabel
    : data.installmentNumber != null
      ? `${data.installmentNumber} / ${data.installmentCount}`
      : `— / ${data.installmentCount}`;

  return (
    <BrandLayout locale={locale} preview={t.preview}>
      <Text style={{ margin: "0 0 4px", fontSize: 15, color: COLORS.body }}>
        {t.greeting(data.clientName)}
      </Text>
      <Text style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: COLORS.text }}>
        {t.title}
      </Text>
      <Text style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.6, color: COLORS.body }}>
        {t.subtitle}
      </Text>

      {/* Amount hero */}
      <Section
        style={{
          margin: "0 0 18px",
          padding: "20px",
          backgroundColor: COLORS.navy,
          borderRadius: 12,
          textAlign: "center",
        }}
      >
        <Text style={{ margin: "0 0 4px", fontSize: 13, color: "#c9d6ea" }}>
          {t.amountLabel}
        </Text>
        <Text style={{ margin: 0, fontSize: 32, fontWeight: 800, color: COLORS.white }}>
          {formatUsd(data.amountCents)}
        </Text>
      </Section>

      {/* Receipt details */}
      <Section
        style={{
          margin: "0 0 18px",
          padding: "16px 18px",
          backgroundColor: COLORS.bg,
          borderRadius: 10,
          border: `1px solid ${COLORS.border}`,
        }}
      >
        <DetailRow label={t.method} value={paymentMethodLabel(data, locale)} />
        <DetailRow label={t.installmentLabel} value={installmentValue} />
        {data.caseNumber ? <DetailRow label={t.caseLabel} value={data.caseNumber} /> : null}
      </Section>

      {/* Plan progress */}
      <Text style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 700, color: COLORS.navy }}>
        {t.progressTitle}
      </Text>
      <Text style={{ margin: "0 0 8px", fontSize: 14, color: COLORS.body }}>
        {t.progressBody(data.paidCount, data.installmentCount)}
      </Text>
      <Section
        style={{
          margin: "0 0 12px",
          height: 10,
          backgroundColor: COLORS.border,
          borderRadius: 999,
        }}
      >
        <Section
          style={{
            width: `${pct}%`,
            height: 10,
            backgroundColor: COLORS.accent,
            borderRadius: 999,
          }}
        >
          {/* filled */}
        </Section>
      </Section>

      {data.remainingCount > 0 ? (
        <Text style={{ margin: "0 0 24px", fontSize: 15, lineHeight: 1.6, color: COLORS.body }}>
          {t.remaining(data.remainingCount, formatUsd(data.remainingAmountCents))}
          {nextDue ? ` ${t.nextDue(nextDue)}` : ""}
        </Text>
      ) : (
        <Text
          style={{ margin: "0 0 24px", fontSize: 15, lineHeight: 1.6, color: COLORS.navy, fontWeight: 600 }}
        >
          {t.done}
        </Text>
      )}

      {ctaUrl ? (
        <Section style={{ marginTop: 4 }}>
          <Button
            href={ctaUrl}
            style={{
              backgroundColor: COLORS.accent,
              color: COLORS.white,
              padding: "12px 28px",
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {t.cta}
          </Button>
        </Section>
      ) : null}

      <Hr style={{ borderColor: COLORS.border, margin: "24px 0 0" }} />
    </BrandLayout>
  );
}
