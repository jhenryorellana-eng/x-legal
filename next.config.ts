import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl without i18n routing (DOC-23 §2.1): request config resolves the
// locale from the user (cookie mirror of users.locale), not from the URL.
const withNextIntl = createNextIntlPlugin("./src/frontend/i18n/request.ts");

const nextConfig: NextConfig = {
  /* config options here */
};

export default withNextIntl(nextConfig);
