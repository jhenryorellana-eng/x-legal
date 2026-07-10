/**
 * ContractReadyEmail — sent when the contract is issued for signing
 * (DOC-73 §2 `contract-ready` ◆). Enriched with the case/plan summary and how
 * to access the app, plus the signing CTA. Sent at case creation.
 */

import { Button, Column, Hr, Row, Section, Text } from "@react-email/components";
import * as React from "react";
import { BrandLayout } from "../BrandLayout";
import { COLORS } from "../theme";
import type { Locale } from "../i18n";
import { formatUsd, frequencyLabel, type ContractReadyEmailData } from "../data";

const COPY = {
  es: {
    preview: "Tu contrato está listo para firmar.",
    greeting: (name: string | null) => (name ? `Hola, ${name}:` : "Hola:"),
    title: "Tu contrato está listo para firmar",
    intro:
      "Preparamos tu contrato de servicios. Revísalo y fírmalo para que podamos comenzar con tu caso.",
    summaryTitle: "Resumen de tu caso",
    service: "Servicio",
    total: "Total",
    downpayment: "Pago inicial",
    installments: "Cuotas",
    installmentsValue: (n: number, freq: string) => `${n} pagos (${freq})`,
    accessTitle: "Cómo ingresar a la app",
    accessBody: (phone: string | null) =>
      phone
        ? `Cuando actives tu caso, ingresa a la app con tu número de teléfono registrado: ${phone}. No necesitas contraseña.`
        : "Cuando actives tu caso, ingresa a la app con el número de teléfono con el que te registramos. No necesitas contraseña.",
    cta: "Revisar y firmar",
  },
  en: {
    preview: "Your contract is ready to sign.",
    greeting: (name: string | null) => (name ? `Hi ${name},` : "Hi,"),
    title: "Your contract is ready to sign",
    intro:
      "We've prepared your service agreement. Review and sign it so we can get started on your case.",
    summaryTitle: "Your case summary",
    service: "Service",
    total: "Total",
    downpayment: "Down payment",
    installments: "Installments",
    installmentsValue: (n: number, freq: string) => `${n} payments (${freq})`,
    accessTitle: "How to log in",
    accessBody: (phone: string | null) =>
      phone
        ? `Once your case is active, log in to the app with your registered phone number: ${phone}. No password needed.`
        : "Once your case is active, log in to the app with the phone number we registered you with. No password needed.",
    cta: "Review and sign",
  },
} as const;

export interface ContractReadyEmailProps {
  locale: Locale;
  data: ContractReadyEmailData;
  /** Absolute signing link (from the notification action_url, /firma/{token}). */
  ctaUrl?: string;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ marginBottom: 6 }}>
      <Column style={{ width: "45%", verticalAlign: "top" }}>
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

export function ContractReadyEmail({ locale, data, ctaUrl }: ContractReadyEmailProps) {
  const t = COPY[locale];

  return (
    <BrandLayout locale={locale} preview={t.preview}>
      <Text style={{ margin: "0 0 4px", fontSize: 15, color: COLORS.body }}>
        {t.greeting(data.clientName)}
      </Text>
      <Text style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 700, color: COLORS.text }}>
        {t.title}
      </Text>
      <Text style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.6, color: COLORS.body }}>
        {t.intro}
      </Text>

      <Section
        style={{
          margin: "0 0 20px",
          padding: "16px 18px",
          backgroundColor: COLORS.bg,
          borderRadius: 10,
          border: `1px solid ${COLORS.border}`,
        }}
      >
        <Text style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: COLORS.navy }}>
          {t.summaryTitle}
        </Text>
        <SummaryRow label={t.service} value={data.serviceName} />
        <SummaryRow label={t.total} value={formatUsd(data.totalCents)} />
        <SummaryRow label={t.downpayment} value={formatUsd(data.downpaymentCents)} />
        <SummaryRow
          label={t.installments}
          value={t.installmentsValue(
            data.installmentCount,
            frequencyLabel(data.frequency, locale),
          )}
        />
      </Section>

      <Text style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: COLORS.navy }}>
        {t.accessTitle}
      </Text>
      <Text style={{ margin: "0 0 24px", fontSize: 14, lineHeight: 1.6, color: COLORS.body }}>
        {t.accessBody(data.phone)}
      </Text>

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
