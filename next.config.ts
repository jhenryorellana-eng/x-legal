import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl without i18n routing (DOC-23 §2.1): request config resolves the
// locale from the user (cookie mirror of users.locale), not from the URL.
const withNextIntl = createNextIntlPlugin("./src/frontend/i18n/request.ts");

const nextConfig: NextConfig = {
  // mupdf is an ESM/WASM package — must NOT be bundled by Next.js webpack.
  // It loads its own .wasm file at runtime via Node.js resolution.
  // Without this, the build fails with "WASM module not found" errors.
  serverExternalPackages: ["mupdf"],
};

export default withNextIntl(nextConfig);
