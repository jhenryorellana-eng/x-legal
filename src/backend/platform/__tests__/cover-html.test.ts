import { describe, it, expect } from "vitest";
import { buildCoverHtml } from "@/backend/platform/pdf";

/**
 * buildCoverHtml — deterministic cover/divider page markup (pure, no mupdf).
 * Court-ready cover model: title in the upper quarter (~25% down), large letters,
 * no gold rule. Asserting on the HTML/CSS is more robust than a PDF byte-snapshot
 * (which would drift with the mupdf version).
 */
const base = {
  caseNumber: "U26-001234",
  clientLabel: "M. Restrepo",
  serviceLabel: "Apelación (BIA)",
};

describe("buildCoverHtml", () => {
  it("portada: título 56pt en el cuarto superior (~198pt), sin línea dorada", () => {
    const html = buildCoverHtml({ ...base, title: "Form EOIR-26", style: "ulp-classic" });
    expect(html).toContain("margin-top:198pt"); // ~25% of 792pt US Letter page
    expect(html).toContain("font-size:56pt");
    expect(html).not.toMatch(/border-top:2pt solid/); // gold rule removed
    expect(html).not.toContain("#c8a24a"); // GOLD no longer referenced here
    expect(html).toContain("Form EOIR-26");
  });

  it("divisor: mantiene 36pt y la misma posición nueva, sin línea dorada", () => {
    const html = buildCoverHtml({ ...base, title: "Parte A", style: "ulp-divider" });
    expect(html).toContain("font-size:36pt");
    expect(html).toContain("margin-top:198pt");
    expect(html).not.toContain("#c8a24a");
  });

  it("sin style declarado se comporta como portada (56pt)", () => {
    const html = buildCoverHtml({ ...base, title: "EXPEDIENTE" });
    expect(html).toContain("font-size:56pt");
  });

  it("renderiza el subtítulo cuando se provee", () => {
    const html = buildCoverHtml({ ...base, title: "Form EOIR-26", subtitle: "Notice of Appeal", style: "ulp-classic" });
    expect(html).toContain("font-size:24pt");
    expect(html).toContain("Notice of Appeal");
  });

  it("escapa HTML en el título (previene inyección de markup)", () => {
    const html = buildCoverHtml({ ...base, title: "A & B <script>", style: "ulp-classic" });
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
