import { describe, it, expect } from "vitest";
import { slugify, toDownloadFilename } from "../strings";

describe("slugify", () => {
  it("kebab-cases and strips accents/diacritics", () => {
    expect(slugify("Pasaporte de Juan")).toBe("pasaporte-de-juan");
    expect(slugify("Evidencia #1 (José)")).toBe("evidencia-1-jose");
    expect(slugify("  Reporte   policial  ")).toBe("reporte-policial");
    expect(slugify("Acta de Nacimiento — María")).toBe("acta-de-nacimiento-maria");
  });

  it("returns empty string for symbol-only input (caller supplies fallback)", () => {
    expect(slugify("***")).toBe("");
    expect(slugify("")).toBe("");
  });
});

describe("toDownloadFilename", () => {
  it("builds a semantic, kebab-cased filename with extension", () => {
    expect(toDownloadFilename("Pasaporte de Juan", "pdf")).toBe("pasaporte-de-juan.pdf");
    expect(toDownloadFilename("reporte policial", "PDF")).toBe("reporte-policial.pdf");
  });

  it("falls back to 'documento' when the name slugifies to empty", () => {
    expect(toDownloadFilename("***", "png")).toBe("documento.png");
  });

  it("omits the dot when there is no extension", () => {
    expect(toDownloadFilename("Evidencias", "")).toBe("evidencias");
  });
});
