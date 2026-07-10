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

    expect(subject).toBe("Recibo de tu cuota inicial");
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

describe("renderTransactionalEmail — rich templates (data-driven)", () => {
  it("routes to the welcome template with the registered phone", async () => {
    const { subject, html } = await renderTransactionalEmail({
      templateKey: "welcome",
      locale: "es",
      title: "welcome",
      actionPath: "/home",
      data: { kind: "welcome", clientName: "María", phone: "+15551234567" },
    });
    expect(subject).toBe("¡Bienvenido a UsaLatinoPrime! Tu caso ya está en marcha");
    expect(html).toContain("María");
    expect(html).toContain("+15551234567");
    expect(html).toContain("Entrar a la app"); // CTA (ctaUrl present)
  });

  it("routes to the contract-ready template with the plan summary", async () => {
    const { subject, html } = await renderTransactionalEmail({
      templateKey: "contract-ready",
      locale: "es",
      title: "contract",
      actionPath: "/firma/tok-123",
      data: {
        kind: "contract-ready",
        clientName: "Carlos",
        phone: "+15559876543",
        serviceName: "Asilo",
        totalCents: 300000,
        downpaymentCents: 100000,
        installmentCount: 6,
        frequency: "monthly",
      },
    });
    expect(subject).toBe("Tu contrato está listo para firmar");
    expect(html).toContain("Asilo");
    expect(html).toContain("$3,000.00"); // total
    expect(html).toContain("$1,000.00"); // downpayment
    expect(html).toContain("+15559876543");
    expect(html).toContain("Revisar y firmar");
  });

  it("routes to the payment receipt with a dynamic 'cuota N de M' subject", async () => {
    const { subject, html } = await renderTransactionalEmail({
      templateKey: "installment-paid",
      locale: "es",
      title: "receipt",
      actionPath: "/pagos",
      data: {
        kind: "payment-receipt",
        clientName: "María",
        amountCents: 20000,
        method: "zelle",
        autopay: false,
        cardLast4: null,
        isDownpayment: false,
        installmentNumber: 2,
        installmentCount: 6,
        paidCount: 2,
        remainingCount: 4,
        remainingAmountCents: 80000,
        nextDueDate: "2026-09-01",
        nextDueAmountCents: 20000,
        caseNumber: "ULP-2026-0007",
      },
    });
    expect(subject).toBe("Recibo de tu pago — cuota 2 de 6");
    expect(html).toContain("$200.00"); // amount
    expect(html).toContain("Zelle"); // method label
    expect(html).toContain("ULP-2026-0007"); // case number
    expect(html).toContain("Ver mis pagos"); // CTA
  });

  it("labels an autopay receipt with the card last4", async () => {
    const { subject, html } = await renderTransactionalEmail({
      templateKey: "downpayment-confirmed",
      locale: "es",
      title: "receipt",
      actionPath: "/pagos",
      data: {
        kind: "payment-receipt",
        clientName: null,
        amountCents: 50000,
        method: "stripe",
        autopay: true,
        cardLast4: "4242",
        isDownpayment: true,
        installmentNumber: 0,
        installmentCount: 4,
        paidCount: 1,
        remainingCount: 3,
        remainingAmountCents: 150000,
        nextDueDate: null,
        nextDueAmountCents: null,
        caseNumber: "ULP-2026-0008",
      },
    });
    expect(subject).toBe("Recibo de tu cuota inicial"); // downpayment subject
    expect(html).toContain("Cobro automático");
    expect(html).toContain("4242");
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
