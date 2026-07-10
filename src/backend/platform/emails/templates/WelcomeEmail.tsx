/**
 * WelcomeEmail — account welcome sent when a client's FIRST case is created
 * (DOC-73 §2 `welcome` ◆). Warm intro + next steps + how to access the app.
 *
 * Access reality (2026): client login is phone-only. We tell them the exact
 * phone number they were registered with (their credential) — no OTP/password.
 */

import { Button, Hr, Section, Text } from "@react-email/components";
import * as React from "react";
import { BrandLayout } from "../BrandLayout";
import { COLORS } from "../theme";
import type { Locale } from "../i18n";
import type { WelcomeEmailData } from "../data";

const COPY = {
  es: {
    preview: "¡Bienvenido a UsaLatinoPrime! Tu caso ya está en marcha.",
    greeting: (name: string | null) => (name ? `¡Hola, ${name}!` : "¡Hola!"),
    title: "¡Bienvenido a UsaLatinoPrime!",
    intro:
      "Gracias por confiar en nosotros. Ya creamos tu caso y nuestro equipo comenzará a acompañarte en cada paso de tu proceso migratorio.",
    stepsTitle: "¿Qué sigue?",
    steps: [
      "Revisa y firma tu contrato (te enviamos el enlace en un correo aparte).",
      "Realiza tu pago inicial para activar el caso.",
      "Ingresa a la app para seguir tu proceso, subir documentos y comunicarte con tu equipo.",
    ],
    accessTitle: "Cómo ingresar a la app",
    accessBody: (phone: string | null) =>
      phone
        ? `Ingresa con tu número de teléfono registrado: ${phone}. No necesitas contraseña.`
        : "Ingresa con el número de teléfono con el que te registramos. No necesitas contraseña.",
    cta: "Entrar a la app",
    noCta: "Ingresa a la app desde tu teléfono cuando quieras.",
  },
  en: {
    preview: "Welcome to UsaLatinoPrime! Your case is underway.",
    greeting: (name: string | null) => (name ? `Hi, ${name}!` : "Hi!"),
    title: "Welcome to UsaLatinoPrime!",
    intro:
      "Thank you for trusting us. Your case has been created and our team will guide you through every step of your immigration process.",
    stepsTitle: "What's next?",
    steps: [
      "Review and sign your contract (we sent the link in a separate email).",
      "Make your initial payment to activate the case.",
      "Log in to the app to follow your process, upload documents, and message your team.",
    ],
    accessTitle: "How to log in",
    accessBody: (phone: string | null) =>
      phone
        ? `Log in with your registered phone number: ${phone}. No password needed.`
        : "Log in with the phone number we registered you with. No password needed.",
    cta: "Open the app",
    noCta: "Log in to the app from your phone anytime.",
  },
} as const;

export interface WelcomeEmailProps {
  locale: Locale;
  data: WelcomeEmailData;
  /** Absolute deep link to the app (from the notification action_url). */
  ctaUrl?: string;
}

export function WelcomeEmail({ locale, data, ctaUrl }: WelcomeEmailProps) {
  const t = COPY[locale];

  return (
    <BrandLayout locale={locale} preview={t.preview}>
      <Text style={{ margin: "0 0 4px", fontSize: 15, color: COLORS.body }}>
        {t.greeting(data.clientName)}
      </Text>
      <Text
        style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 700, color: COLORS.text }}
      >
        {t.title}
      </Text>
      <Text style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.6, color: COLORS.body }}>
        {t.intro}
      </Text>

      <Text style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: COLORS.navy }}>
        {t.stepsTitle}
      </Text>
      <Section style={{ margin: "0 0 20px" }}>
        {t.steps.map((step, i) => (
          <Text
            key={i}
            style={{ margin: "0 0 8px", fontSize: 15, lineHeight: 1.6, color: COLORS.body }}
          >
            <span style={{ color: COLORS.accent, fontWeight: 700 }}>{i + 1}.</span> {step}
          </Text>
        ))}
      </Section>

      <Section
        style={{
          margin: "0 0 24px",
          padding: "16px 18px",
          backgroundColor: COLORS.bg,
          borderRadius: 10,
          border: `1px solid ${COLORS.border}`,
        }}
      >
        <Text style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 700, color: COLORS.navy }}>
          {t.accessTitle}
        </Text>
        <Text style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: COLORS.body }}>
          {t.accessBody(data.phone)}
        </Text>
      </Section>

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
      ) : (
        <Text style={{ margin: 0, fontSize: 14, color: COLORS.muted }}>{t.noCta}</Text>
      )}

      <Hr style={{ borderColor: COLORS.border, margin: "24px 0 0" }} />
    </BrandLayout>
  );
}
