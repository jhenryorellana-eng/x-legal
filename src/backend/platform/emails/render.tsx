/**
 * Email render entrypoint (DOC-73 §3) — the single place that turns a templateKey
 * + props into `{ subject, html, text }` for Resend.
 *
 * Replaces the old hardcoded `buildEmailHtml`/`buildEmailSubject` in
 * deliver-notification. Server-only: invoked from QStash job handlers and the
 * campaigns service (sendTest), never from a client bundle.
 */

import { render, toPlainText } from "@react-email/render";
import { NotificationEmail } from "./templates/NotificationEmail";
import { CampaignEmail } from "./templates/CampaignEmail";
import { ctaLabel, emailSubject, pickLocale } from "./i18n";
import { env } from "../env";

/** Resolves a relative deep-link path to an absolute URL on the app origin. */
function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${env.NEXT_PUBLIC_APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Renders a branded transactional email from a notification's localized fields.
 */
export async function renderTransactionalEmail(input: {
  templateKey: string;
  locale: string;
  title: string;
  body?: string | null;
  /** Relative deep-link path (e.g. "/caso/123") or absolute URL. */
  actionPath?: string | null;
}): Promise<{ subject: string; html: string; text: string }> {
  const locale = pickLocale(input.locale);
  const subject = emailSubject(input.templateKey, locale, input.title);
  const ctaUrl = input.actionPath ? absoluteUrl(input.actionPath) : undefined;

  const html = await render(
    <NotificationEmail
      locale={locale}
      preview={input.title}
      title={input.title}
      body={input.body ?? undefined}
      ctaText={ctaUrl ? ctaLabel(locale) : undefined}
      ctaUrl={ctaUrl}
    />,
  );

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
