import { Logo } from "@/frontend/components/brand/logo";

/**
 * BrandBar — the real logo mark + "X LEGAL" wordmark (DOC-01 §0.6).
 *
 * Local to the public signing surface (the only place outside the app shells
 * that needs full branding without nav, DOC-50 §1.2). Presentational only.
 */
export function BrandBar() {
  return (
    <Logo
      size={46}
      withWordmark
      direction="column"
      wordmarkSize={17}
      elevated
      label="X Legal"
    />
  );
}

/** Formats integer cents as USD ($1,500.00) — es-US/en-US render identically. */
export function formatCents(cents: number, locale: "es" | "en" = "es"): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-US", {
    style: "currency",
    currency: "USD",
  }).format((cents ?? 0) / 100);
}
