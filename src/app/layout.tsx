import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { plusJakartaSans } from "@/frontend/design-system/fonts";
import { THEME_INIT_SCRIPT } from "@/frontend/lib/theme";

export const metadata: Metadata = {
  title: "UsaLatinoPrime",
  description: "UsaLatinoPrime — tu equipo legal, siempre contigo.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolved by src/frontend/i18n/request.ts (cookie mirror of users.locale).
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      data-theme="light"
      data-text-scale="md"
      suppressHydrationWarning
    >
      <head>
        {/* No-flash theme bootstrap: runs before hydration, reads localStorage. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${plusJakartaSans.variable} antialiased`}>
        {/* Inherits locale/messages/timeZone from i18n/request.ts (next-intl v4) */}
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
