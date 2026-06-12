/**
 * Cambiar contraseña — /cambiar-password (DOC-22 §2.2)
 *
 * Authenticated staff page. Forces password change on first login.
 * Middleware redirects here when app_metadata.must_change_password === true.
 */

import { getTranslations } from "next-intl/server";
import { CambiarPasswordScreen } from "./cambiar-password-screen";

export default async function CambiarPasswordPage() {
  const t = await getTranslations("staff.cambiarPassword");

  return (
    <CambiarPasswordScreen
      messages={{
        title: t("title"),
        body: t("body"),
        newPasswordLabel: t("newPasswordLabel"),
        confirmPasswordLabel: t("confirmPasswordLabel"),
        cta: t("cta"),
        requirements: t("requirements"),
        errorTooShort: t("errorTooShort"),
        errorTooWeak: t("errorTooWeak"),
        errorMismatch: t("errorMismatch"),
      }}
    />
  );
}
