/**
 * BrandBar — tricolor mark + "USALATINO PRIME" wordmark (DOC-01 §0.6).
 *
 * Local to the public signing surface (the only place outside the app shells
 * that needs full branding without nav, DOC-50 §1.2). Presentational only.
 */
export function BrandBar() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          width: 46,
          height: 7,
          borderRadius: 999,
          overflow: "hidden",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <span style={{ flex: 1, background: "var(--navy)" }} />
        <span style={{ flex: 1, background: "#ffffff" }} />
        <span style={{ flex: 1, background: "var(--red)" }} />
      </div>
      <div
        style={{
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 17,
          letterSpacing: "-0.01em",
          color: "var(--navy)",
        }}
      >
        USALATINO<span style={{ color: "var(--accent)" }}>PRIME</span>
      </div>
    </div>
  );
}

/** Formats integer cents as USD ($1,500.00) — es-US/en-US render identically. */
export function formatCents(cents: number, locale: "es" | "en" = "es"): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-US", {
    style: "currency",
    currency: "USD",
  }).format((cents ?? 0) / 100);
}
