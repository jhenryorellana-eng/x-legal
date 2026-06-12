/**
 * Recuperar contraseña — /reset-password (DOC-22 §2.4)
 *
 * Public page. Two modes:
 * 1. No `code` in URL: show email form → request reset link.
 * 2. With `code` in URL (Supabase redirect): already handled by middleware
 *    (Supabase sets the session from the token_hash) → redirect to /cambiar-password.
 *
 * For F0, we implement mode 1 (request form).
 * Mode 2 is handled by the middleware/Supabase SSR automatically.
 */

import { getTranslations } from "next-intl/server";
import { ResetPasswordScreen } from "./reset-password-screen";

export default async function ResetPasswordPage() {
  const t = await getTranslations("staff.resetPassword");

  return (
    <ResetPasswordScreen
      messages={{
        title: t("title"),
        body: t("body"),
        emailLabel: t("emailLabel"),
        cta: t("cta"),
        successMessage: t("successMessage"),
        backToLogin: t("backToLogin"),
      }}
    />
  );
}
