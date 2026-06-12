/**
 * Entrar con teléfono — /phone (DOC-51-UI-CLIENTE §3, PROMPT-CLI-03)
 *
 * Public, no session required.
 * Client component for live phone mask + validation.
 */

import { getTranslations } from "next-intl/server";
import { PhoneScreen } from "./phone-screen";

export default async function PhonePage() {
  const t = await getTranslations("cliente.phone");

  return (
    <PhoneScreen
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
        errorGeneric: t("errorGeneric"),
      }}
    />
  );
}
