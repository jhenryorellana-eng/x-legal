/**
 * Entrar con correo — /email (DOC-22 §1, DOC-51-UI-CLIENTE §3, PROMPT-CLI-03)
 *
 * Replaces /phone after the email-OTP migration (DOC-22 §1 decision June 2026).
 * Public, no session required.
 * Client component for live email validation.
 */

import { getTranslations } from "next-intl/server";
import { EmailScreen } from "./email-screen";

export default async function EmailPage() {
  const t = await getTranslations("cliente.email");

  return (
    <EmailScreen
      messages={{
        eyebrow: t("eyebrow"),
        title: t("title"),
        body: t("body"),
        placeholder: t("placeholder"),
        trustBadge: t("trustBadge"),
        cta: t("cta"),
        noAccess: t("noAccess"),
        footerBadge: t("footerBadge"),
        errorRateLimit: t("errorRateLimit"),
        errorInvalidEmail: t("errorInvalidEmail"),
        errorGeneric: t("errorGeneric"),
      }}
    />
  );
}
