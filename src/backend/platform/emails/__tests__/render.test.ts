/**
 * Tests for the email render layer (DOC-73 §3).
 *
 * Verifies: brand layout present, subject resolution + locale fallback,
 * unsubscribe present ONLY in campaigns, and react-email escaping of content.
 */

import { describe, it, expect } from "vitest";

// Must set core env BEFORE importing the emails module (env.ts parses at load).
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
process.env.ENCRYPTION_KEY ??= Buffer.from(new Uint8Array(32)).toString("base64");

const { renderTransactionalEmail, renderCampaignEmail } = await import(
  "@/backend/platform/emails"
);

describe("renderTransactionalEmail", () => {
  it("renders the brand layout with title, body and a CTA", async () => {
    const { subject, html, text } = await renderTransactionalEmail({
      templateKey: "downpayment-confirmed",
      locale: "es",
      title: "Bienvenido a tu caso",
      body: "Tu pago inicial fue recibido.",
      actionPath: "/caso/abc-123",
    });

    expect(subject).toBe("Bienvenido — tu caso está activo");
    // Brand: logo alt ("X Legal") + wordmark suffix ("LEGAL")
    expect(html).toContain("X Legal");
    expect(html).toContain("LEGAL");
    // Content
    expect(html).toContain("Bienvenido a tu caso");
    expect(html).toContain("Tu pago inicial fue recibido.");
    // CTA deep link resolved to an absolute URL
    expect(html).toContain("/caso/abc-123");
    // Transactional emails NEVER carry an unsubscribe link
    expect(html).not.toContain("Darse de baja");
    // Plain text fallback is produced
    expect(text.length).toBeGreaterThan(0);
  });

  it("falls back to the provided title when the templateKey has no subject", async () => {
    const { subject } = await renderTransactionalEmail({
      templateKey: "unknown-key-xyz",
      locale: "es",
      title: "Asunto de respaldo",
    });
    expect(subject).toBe("Asunto de respaldo");
  });

  it("falls back to Spanish for an unsupported locale", async () => {
    const { subject } = await renderTransactionalEmail({
      templateKey: "document-approved",
      locale: "fr",
      title: "x",
    });
    expect(subject).toBe("Tu documento fue aprobado");
  });

  it("uses the English subject for en locale", async () => {
    const { subject } = await renderTransactionalEmail({
      templateKey: "document-approved",
      locale: "en",
      title: "x",
    });
    expect(subject).toBe("Your document was approved");
  });

  it("escapes HTML in title/body (react-email default)", async () => {
    const { html } = await renderTransactionalEmail({
      templateKey: "document-approved",
      locale: "es",
      title: "<script>alert(1)</script>",
      body: "<img src=x onerror=alert(2)>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(2)>");
    // The escaped form is present
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderCampaignEmail", () => {
  it("injects staff body HTML and ALWAYS renders the unsubscribe link", async () => {
    const { html, text } = await renderCampaignEmail({
      locale: "es",
      subject: "Novedades de junio",
      bodyHtml: "<h2>Hola</h2><p>Tenemos noticias para ti.</p>",
      unsubscribeUrl: "https://app.example.com/api/unsubscribe?c=1&u=2&t=abc",
    });

    // Staff HTML preserved verbatim
    expect(html).toContain("<h2>Hola</h2>");
    expect(html).toContain("Tenemos noticias para ti.");
    // Mandatory unsubscribe (CAN-SPAM)
    expect(html).toContain("Darse de baja");
    expect(html).toContain("https://app.example.com/api/unsubscribe?c=1&amp;u=2&amp;t=abc");
    expect(text.length).toBeGreaterThan(0);
  });
});
