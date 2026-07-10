/**
 * Email i18n — subjects + footer copy keyed by recipient locale (DOC-73 §3.3).
 *
 * The recipient's locale comes from `users.locale` (default "es"). Anything
 * that is not "en" falls back to Spanish — the product's primary language.
 */

export type Locale = "es" | "en";

/** Narrows an arbitrary locale string to the two supported email locales. */
export function pickLocale(locale: string | null | undefined): Locale {
  return locale === "en" ? "en" : "es";
}

/** Generic CTA label used by the notification template. */
export function ctaLabel(locale: Locale): string {
  return locale === "en" ? "View details" : "Ver detalles";
}

/** Footer copy (legal line + reason + unsubscribe label). */
export function footerCopy(locale: Locale): {
  legal: string;
  reason: string;
  unsubscribe: string;
} {
  return locale === "en"
    ? {
        legal: "UsaLatinoPrime — Immigration services",
        reason:
          "You are receiving this email because you have a case or an account with UsaLatinoPrime.",
        unsubscribe: "Unsubscribe from updates",
      }
    : {
        legal: "UsaLatinoPrime — Servicios de inmigración",
        reason:
          "Recibes este correo porque tienes un caso o una cuenta en UsaLatinoPrime.",
        unsubscribe: "Darse de baja de novedades",
      };
}

/**
 * Subject lines per templateKey (DOC-73 §2 catalog). Migrated from the old
 * hardcoded `buildEmailSubject` in deliver-notification, plus the reminder and
 * receipt keys that previously fell back to the raw key string.
 */
export const SUBJECTS: Record<string, { es: string; en: string }> = {
  // Account onboarding — welcome (first case created)
  welcome: {
    es: "¡Bienvenido a UsaLatinoPrime! Tu caso ya está en marcha",
    en: "Welcome to UsaLatinoPrime! Your case is underway",
  },
  // F2 — contracts / documents / downpayment
  "contract-ready": {
    es: "Tu contrato está listo para firmar",
    en: "Your contract is ready to sign",
  },
  "contract-signed-finance": {
    es: "Nuevo contrato firmado — cobrar cuota inicial",
    en: "New contract signed — collect down payment",
  },
  "document-approved": {
    es: "Tu documento fue aprobado",
    en: "Your document was approved",
  },
  "document-rejected": {
    es: "Tu documento necesita una corrección",
    en: "Your document needs a correction",
  },
  "form-approved": {
    es: "Tu formulario fue aprobado",
    en: "Your form was approved",
  },
  "form-rejected": {
    es: "Tu formulario necesita una corrección",
    en: "Your form needs a correction",
  },
  "downpayment-confirmed-sales": {
    es: "Pago inicial recibido — caso activo",
    en: "Down payment received — case is active",
  },
  // Down-payment receipt (welcome moved to the `welcome` template at case creation).
  "downpayment-confirmed": {
    es: "Recibo de tu cuota inicial",
    en: "Your down payment receipt",
  },
  // F3 — appointments
  "appointment-booked": {
    es: "Tu cita quedó agendada",
    en: "Your appointment is confirmed",
  },
  "appointment-cancelled": {
    es: "Tu cita fue cancelada",
    en: "Your appointment was cancelled",
  },
  "appointment-rescheduled": {
    es: "Tu cita cambió de fecha",
    en: "Your appointment has been rescheduled",
  },
  "appointment-no-show": {
    es: "No asististe a tu cita",
    en: "You missed your appointment",
  },
  "appointment-24h": {
    es: "Tu cita es mañana",
    en: "Your appointment is tomorrow",
  },
  "appointment-1h": {
    es: "Tu cita comienza en 1 hora",
    en: "Your appointment starts in 1 hour",
  },
  // F6 — billing reminders + receipt (DOC-73 §2)
  "installment-reminder-3d": {
    es: "Tu cuota vence en 3 días",
    en: "Your installment is due in 3 days",
  },
  "installment-reminder-due": {
    es: "Tu cuota vence hoy",
    en: "Your installment is due today",
  },
  "installment-overdue": {
    es: "Tienes una cuota vencida",
    en: "You have an overdue installment",
  },
  "installment-paid": {
    es: "Recibo de tu pago",
    en: "Your payment receipt",
  },
};

/** Returns the subject for a templateKey, falling back to a provided title. */
export function emailSubject(
  templateKey: string,
  locale: Locale,
  fallback?: string,
): string {
  return SUBJECTS[templateKey]?.[locale] ?? fallback ?? templateKey;
}
