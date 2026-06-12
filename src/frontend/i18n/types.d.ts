// Strict typing of message keys — DOC-23 §2.3, updated to the next-intl v4
// `AppConfig` augmentation (v4 replaced the global `IntlMessages` interface).
// es.json is the source of the type: a missing key fails `tsc`, while es/en
// parity is enforced separately by scripts/check-i18n-keys.mjs (RNF-027).
import type { Locale } from "@/shared/i18n";

type EsMessages = typeof import("./messages/es.json");

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: EsMessages;
  }
}
