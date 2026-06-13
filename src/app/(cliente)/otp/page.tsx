/**
 * Código OTP — /otp (DOC-51-UI-CLIENTE §4, PROMPT-CLI-04)
 *
 * Public, no session required.
 * Shows 6-box OTP input, 45s countdown timer, resend/change-email links.
 * Email OTP migration (DOC-22 §1, June 2026): reads ?email= instead of ?phone=.
 */

import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { OtpScreen } from "./otp-screen";

export default async function OtpPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  // /otp only makes sense after entering an email on /email
  const { email } = await searchParams;
  if (!email) redirect("/email");

  const t = await getTranslations("cliente.otp");

  return (
    <OtpScreen
      messages={{
        title: t("title"),
        bodyPrefix: t("bodyPrefix"),
        // raw(): the message keeps its {seconds} placeholder — the client
        // screen interpolates it on every countdown tick.
        resendCountdown: t.raw("resendCountdown"),
        resendBtn: t("resendBtn"),
        changeEmail: t("changeEmail"),
        cta: t("cta"),
        footerBadge: t("footerBadge"),
        errorCode: t("errorCode"),
        errorRateLimit: t("errorRateLimit"),
      }}
    />
  );
}
