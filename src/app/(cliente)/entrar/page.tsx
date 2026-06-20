/**
 * Entrar con teléfono — /entrar (DOC-22 §1, phone-only login, June 2026)
 *
 * Replaces /email + /otp after the phone-only login decision (June 2026): the
 * client types ONLY their phone number and is signed in directly (no OTP yet —
 * SMS-OTP comes later). Public, no session required. Client component for live
 * phone validation. Reuses the `cliente.phone` i18n namespace.
 */

import { getTranslations } from "next-intl/server";
import { EntrarScreen } from "./entrar-screen";

export default async function EntrarPage() {
  const t = await getTranslations("cliente.phone");

  return (
    <EntrarScreen
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
        errorInvalidPhone: t("errorInvalidPhone"),
        errorNoAccess: t("errorNoAccess"),
        errorGeneric: t("errorGeneric"),
      }}
    />
  );
}
