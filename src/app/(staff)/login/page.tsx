/**
 * Staff login — /login (DOC-22 §2.1)
 *
 * Public (no session), staff surface entry point.
 * Email + password authentication.
 */

import { getTranslations } from "next-intl/server";
import { StaffLoginScreen } from "./login-screen";

export default async function StaffLoginPage() {
  const t = await getTranslations("staff.login");

  return (
    <StaffLoginScreen
      messages={{
        title: t("title"),
        subtitle: t("subtitle"),
        emailLabel: t("emailLabel"),
        passwordLabel: t("passwordLabel"),
        cta: t("cta"),
        forgotPassword: t("forgotPassword"),
        clientAccess: t("clientAccess"),
        errorCredentials: t("errorCredentials"),
        errorRateLimit: t("errorRateLimit"),
        errorGeneric: t("errorGeneric"),
      }}
    />
  );
}
