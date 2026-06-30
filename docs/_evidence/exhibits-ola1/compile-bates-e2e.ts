/**
 * compile-bates-e2e.ts — LIVE test of compileExpedientePdf: merge + auto-TOC +
 * continuous Bates foliation (USALP-0001…). Builds two multi-page PDFs, compiles
 * them, and verifies the page count, the TOC, and that the Bates stamp is present
 * on the pages (extracted via mupdf).
 *
 * Run:  npx -y tsx docs/_evidence/exhibits-ola1/compile-bates-e2e.ts
 */
import { PDFDocument, StandardFonts } from "pdf-lib";

async function makePdf(pages: number, label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`${label} — content page ${i + 1}`, { x: 72, y: 700, size: 14, font });
  }
  return doc.save();
}

async function main() {
  const { compileExpedientePdf, extractPdfText } = await import("../../../src/backend/platform/pdf");

  const memo = await makePdf(3, "AI MEMORANDUM");
  const exhibitA = await makePdf(2, "Exhibit A-1 — HRW Venezuela");

  const result = await compileExpedientePdf([
    { bytes: memo, mimeType: "application/pdf", title: "Credible-Fear Memorandum", includeInToc: true },
    { bytes: exhibitA, mimeType: "application/pdf", title: "Exhibit A-1 — HRW: Venezuela 2024", includeInToc: true },
  ]);

  const validPdf = Buffer.from(result.pdf.subarray(0, 4)).toString("latin1") === "%PDF";
  // Expected pages = TOC pages (≥1) + 3 + 2
  const expectedMin = 1 + 3 + 2;
  const allText = await extractPdfText(result.pdf);
  const hasBates0001 = /USALP-0001/.test(allText);
  const batesCount = (allText.match(/USALP-\d{4}/g) ?? []).length;
  const hasToc = /Índice del expediente/.test(allText);

  console.log("== compile + Bates E2E ==");
  console.log(`valid PDF:        ${validPdf}`);
  console.log(`page count:       ${result.pageCount} (expected ≥ ${expectedMin})`);
  console.log(`TOC entries:      ${result.toc.map((t) => `${t.title}@p${t.startPage}`).join(" | ")}`);
  console.log(`TOC header found: ${hasToc}`);
  console.log(`Bates USALP-0001: ${hasBates0001}`);
  console.log(`Bates stamps:     ${batesCount} (expected = ${result.pageCount})`);

  const ok =
    validPdf && result.pageCount >= expectedMin && hasBates0001 && hasToc && batesCount === result.pageCount;
  console.log(`\n==== ${ok ? "PASS" : "FAIL"} ====`);
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error("error:", e);
  process.exit(1);
});
