import { describe, it, expect } from "vitest";
import { buildCertifiedTranslationHtml, SIGNATURE_ANCHOR } from "@/backend/platform/pdf";

/**
 * buildCertifiedTranslationHtml — composes the certified-translation document
 * (global title stating the language direction + document body + translator's
 * certification with the configured signer name + an invisible stamp anchor).
 * Pure function (no mupdf), so it is unit-testable in isolation. Fixed strings
 * must be in the TARGET language; the signer name goes between "I," and "hereby".
 */
describe("buildCertifiedTranslationHtml", () => {
  const body = "<h1>Birth Certificate</h1><p>Juan Pérez, born 1990.</p>";

  it("es-en: global title states the direction; the document title stays in the body", () => {
    const html = buildCertifiedTranslationHtml(body, "es-en", { signerName: "Andrew Navarro", signedDate: "29 June 2026" });
    // Global title (largest) names the direction; the document's own title is separate.
    expect(html).toContain("CERTIFIED TRANSLATION FROM SPANISH TO ENGLISH");
    expect(html).toContain(body); // document title + content embedded verbatim
    expect(html).toContain("TRANSLATION CERTIFICATION");
    // Name inserted between "I," and "hereby certify".
    expect(html).toContain("I, Andrew Navarro, hereby certify that I translated the attached document from Spanish into English");
    expect(html).toContain("Signature:");
    expect(html).toContain("Date: 29 June 2026");
    // Invisible stamp anchor present for stampSignatureOnPdf.
    expect(html).toContain(SIGNATURE_ANCHOR);
    // No Spanish certification leaked.
    expect(html).not.toContain("CERTIFICACIÓN DE LA TRADUCCIÓN");
  });

  it("en-es: Spanish global title + certification in the target language, name inserted", () => {
    const html = buildCertifiedTranslationHtml(body, "en-es", { signerName: "Andrew Navarro" });
    expect(html).toContain("TRADUCCIÓN CERTIFICADA DEL INGLÉS AL ESPAÑOL");
    expect(html).toContain("CERTIFICACIÓN DE LA TRADUCCIÓN");
    expect(html).toContain("Yo, Andrew Navarro, certifico que traduje el documento adjunto del inglés al español");
    expect(html).toContain("Firma:");
    expect(html).toContain("Fecha:");
    expect(html).toContain(body);
    expect(html).not.toContain("CERTIFIED TRANSLATION FROM SPANISH TO ENGLISH");
  });

  it("falls back to an impersonal certification when no signer name is configured", () => {
    const html = buildCertifiedTranslationHtml(body, "es-en");
    expect(html).toContain("CERTIFIED TRANSLATION FROM SPANISH TO ENGLISH");
    // No dangling "I, ," when the name is absent.
    expect(html).not.toContain("I, ,");
    expect(html).toContain("I hereby certify that the attached document was translated from Spanish into English");
    expect(html).toContain(SIGNATURE_ANCHOR);
  });
});
