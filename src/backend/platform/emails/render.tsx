/**
 * Email render entrypoint (DOC-73 §3) — the single place that turns a templateKey
 * + props into `{ subject, html, text }` for Resend.
 *
 * Replaces the old hardcoded `buildEmailHtml`/`buildEmailSubject` in
 * deliver-notification. Server-only: invoked from QStash job handlers and the
 * campaigns service (sendTest), never from a client bundle.
 */

import type { ReactElement } from "react";
import { render, toPlainText } from "@react-email/render";
import { NotificationEmail } from "./templates/NotificationEmail";
import { CampaignEmail } from "./templates/CampaignEmail";
import { WelcomeEmail } from "./templates/WelcomeEmail";
import { ContractReadyEmail } from "./templates/ContractReadyEmail";
import { PaymentReceiptEmail } from "./templates/PaymentReceiptEmail";
import { ctaLabel, emailSubject, pickLocale, type Locale } from "./i18n";
import type { EmailData, PaymentReceiptEmailData } from "./data";
import { env } from "../env";

/** Resolves a relative deep-link path to an absolute URL on the app origin. */
function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${env.NEXT_PUBLIC_APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Dynamic subject for a payment receipt ("cuota {n} de {total}" — DOC-73 §2). */
function paymentReceiptSubject(
  data: PaymentReceiptEmailData,
  locale: Locale,
  templateKey: string,
  fallback: string,
): string {
  if (data.isDownpayment) {
    return locale === "en" ? "Your down payment receipt" : "Recibo de tu cuota inicial";
  }
  if (data.installmentNumber != null) {
    return locale === "en"
      ? `Your payment receipt — installment ${data.installmentNumber} of ${data.installmentCount}`
      : `Recibo de tu pago — cuota ${data.installmentNumber} de ${data.installmentCount}`;
  }
  return emailSubject(templateKey, locale, fallback);
}

/**
 * Renders a branded transactional email. Rich, data-driven templates route by
 * `data.kind`; without `data` it falls back to the generic NotificationEmail
 * (driven by the notification's localized title/body).
 */
export async function renderTransactionalEmail(input: {
  templateKey: string;
  locale: string;
  title: string;
  body?: string | null;
  /** Relative deep-link path (e.g. "/caso/123") or absolute URL. */
  actionPath?: string | null;
  /** Structured payload for rich templates (welcome, contract, receipt). */
  data?: EmailData | null;
}): Promise<{ subject: string; html: string; text: string }> {
  const locale = pickLocale(input.locale);
  const ctaUrl = input.actionPath ? absoluteUrl(input.actionPath) : undefined;
  const data = input.data ?? undefined;

  let element: ReactElement;
  let subject: string;

  if (data?.kind === "welcome") {
    element = <WelcomeEmail locale={locale} data={data} ctaUrl={ctaUrl} />;
    subject = emailSubject(input.templateKey, locale, input.title);
  } else if (data?.kind === "contract-ready") {
    element = <ContractReadyEmail locale={locale} data={data} ctaUrl={ctaUrl} />;
    subject = emailSubject(input.templateKey, locale, input.title);
  } else if (data?.kind === "payment-receipt") {
    element = <PaymentReceiptEmail locale={locale} data={data} ctaUrl={ctaUrl} />;
    subject = paymentReceiptSubject(data, locale, input.templateKey, input.title);
  } else {
    element = (
      <NotificationEmail
        locale={locale}
        preview={input.title}
        title={input.title}
        body={input.body ?? undefined}
        ctaText={ctaUrl ? ctaLabel(locale) : undefined}
        ctaUrl={ctaUrl}
      />
    );
    subject = emailSubject(input.templateKey, locale, input.title);
  }

  const html = await render(element);
  return { subject, html, text: toPlainText(html) };
}

/**
 * Renders a branded campaign email (staff body HTML + mandatory unsubscribe).
 */
export async function renderCampaignEmail(input: {
  locale: string;
  subject: string;
  bodyHtml: string;
  unsubscribeUrl: string;
  preview?: string;
}): Promise<{ html: string; text: string }> {
  const locale = pickLocale(input.locale);

  const html = await render(
    <CampaignEmail
      locale={locale}
      preview={input.preview ?? input.subject}
      bodyHtml={input.bodyHtml}
      unsubscribeUrl={input.unsubscribeUrl}
    />,
  );

  return { html, text: toPlainText(html) };
}
