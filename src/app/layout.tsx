import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { plusJakartaSans } from "@/frontend/design-system/fonts";
import { THEME_INIT_SCRIPT } from "@/frontend/lib/theme";

export const metadata: Metadata = {
  title: "X Legal",
  description: "X Legal — tu equipo legal, siempre contigo.",
  // PWA install metadata (DOC-24 §2.2).
  manifest: "/manifest.webmanifest",
  applicationName: "X Legal",
  appleWebApp: { capable: true, title: "X Legal", statusBarStyle: "default" },
  // Favicon (transparent), apple-touch (white) and favicon.ico are provided by the
  // Next.js file conventions src/app/{icon.png,apple-icon.png,favicon.ico} — no manual
  // `icons` override here, or the white 192 manifest tile would win the browser tab.
};

// `viewport-fit=cover` lets the app paint into the notch / gesture-bar zones and
// is REQUIRED for `env(safe-area-inset-*)` to resolve to the real device insets
// (DOC-24 §5.5). Zoom is left enabled (no maximumScale) for accessibility. The
// theme-color tracks light/dark so the OS status bar blends with the app bg.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F7FB" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1322" },
  ],
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
      // The next/font variable MUST live on <html> (:root) — the design tokens
      // `--font-title`/`--font-body` reference `var(--font-plus-jakarta)` at :root,
      // so the variable has to be in that same scope or it resolves to invalid and
      // every element falls back to system-ui (DOC-01 §2).
      className={plusJakartaSans.variable}
      data-theme="light"
      data-text-scale="md"
      suppressHydrationWarning
    >
      <head>
        {/* No-flash theme bootstrap: runs before hydration, reads localStorage.
         * The CSP nonce is injected by Next.js automatically (it reads the CSP
         * request header set by middleware.ts) — DON'T set it manually here or
         * React clears it on the client and the hydration mismatches. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        {/* Inherits locale/messages/timeZone from i18n/request.ts (next-intl v4) */}
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
