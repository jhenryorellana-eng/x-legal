/**
 * Código OTP — /otp (DOC-51-UI-CLIENTE §4, PROMPT-CLI-04)
 *
 * Public, no session required.
 * Shows 6-box OTP input, 45s countdown timer, resend/change-number links.
 */

import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { OtpScreen } from "./otp-screen";

export default async function OtpPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string }>;
}) {
  // /otp only makes sense after entering a phone on /phone
  const { phone } = await searchParams;
  if (!phone) redirect("/phone");

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
        changeNumber: t("changeNumber"),
        cta: t("cta"),
        footerBadge: t("footerBadge"),
        errorCode: t("errorCode"),
        errorRateLimit: t("errorRateLimit"),
      }}
    />
  );
}
