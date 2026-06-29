import { describe, it, expect } from "vitest";
import { buildCertifiedTranslationHtml } from "@/backend/platform/pdf";

/**
 * buildCertifiedTranslationHtml — composes the certified-translation document
 * (title + body + translator's certification). Pure function (no mupdf), so it
 * is unit-testable in isolation. The fixed strings must be in the TARGET language.
 */
describe("buildCertifiedTranslationHtml", () => {
  const body = "<h1>Birth Certificate</h1><p>Juan Pérez, born 1990.</p>";

  it("es-en: English title + certification + signature lines, embeds the body", () => {
    const html = buildCertifiedTranslationHtml(body, "es-en");
    expect(html).toContain("CERTIFIED ENGLISH TRANSLATION");
    expect(html).toContain("TRANSLATOR'S CERTIFICATION");
    expect(html).toContain("I certify that I am competent to translate from Spanish to English");
    expect(html).toContain("Signature");
    expect(html).toContain("Date");
    expect(html).toContain("Printed name");
    // The translated body is embedded verbatim.
    expect(html).toContain(body);
    // A signed document needs blank rule lines for the human translator.
    expect(html).toContain("border-bottom:1pt solid #111");
    // No Spanish certification leaked into the English document.
    expect(html).not.toContain("CERTIFICACIÓN DEL TRADUCTOR");
  });

  it("en-es: Spanish title + certification in the target language", () => {
    const html = buildCertifiedTranslationHtml(body, "en-es");
    expect(html).toContain("TRADUCCIÓN CERTIFICADA AL ESPAÑOL");
    expect(html).toContain("CERTIFICACIÓN DEL TRADUCTOR");
    expect(html).toContain("Certifico que soy competente para traducir del inglés al español");
    expect(html).toContain("Firma");
    expect(html).toContain("Fecha");
    expect(html).toContain(body);
    expect(html).not.toContain("CERTIFIED ENGLISH TRANSLATION");
  });
});
