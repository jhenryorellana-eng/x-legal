import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";

// next-intl without i18n routing (DOC-23 §2.1): request config resolves the
// locale from the user (cookie mirror of users.locale), not from the URL.
const withNextIntl = createNextIntlPlugin("./src/frontend/i18n/request.ts");

// PWA service worker (DOC-24 §2.1). Disabled in dev so HMR is never served a
// cached chunk (the committed push-only public/sw.js keeps Web Push working in
// dev); the production build compiles src/app/sw.ts → public/sw.js. We register
// /sw.js ourselves (push-helpers) and drive the update banner, so register:false.
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  register: false,
  reloadOnOnline: true,
  // The offline fallback + Lex are static public/ files (the /offline page is
  // server-rendered, so it can't be precached). Inject them into the precache so
  // the SW can serve a branded offline screen with zero network (DOC-24 §2.4).
  // Bump `revision` when either file changes.
  additionalPrecacheEntries: [
    { url: "/offline.html", revision: "v1" },
    { url: "/assets/lex.webp", revision: "v2" },
  ],
});

const nextConfig: NextConfig = {
  // mupdf is an ESM/WASM package — must NOT be bundled by Next.js webpack.
  // It loads its own .wasm file at runtime via Node.js resolution.
  // Without this, the build fails with "WASM module not found" errors.
  serverExternalPackages: ["mupdf"],

  // Static security headers (DOC-27 §6). The nonce-based CSP is per-request and
  // lives in middleware.ts (Report-Only for the rollout window). These 5 are
  // static + enforcing and apply to every response.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Force HTTPS for 2 years incl. subdomains (ignored on http://localhost).
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // Block MIME-sniffing.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Don't leak full URLs cross-origin.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Camera (doc capture) + mic (dictation) + geolocation (one-time TZ/city
          // detection in Configuración, DOC-23 §6.5) allowed for same-origin only;
          // Payment Request API disabled (Stripe is a redirect).
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=()" },
          // Legacy clickjacking guard (CSP frame-ancestors 'none' is the modern one).
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default withSerwist(withNextIntl(nextConfig));
