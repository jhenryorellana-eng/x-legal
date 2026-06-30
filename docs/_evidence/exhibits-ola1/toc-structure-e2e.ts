/**
 * toc-structure-e2e.ts — verifies the NEW formal expediente structure (LIVE compile):
 *   1. master index header is "Table of Contents" (English), not "Índice del expediente";
 *   2. a single "Index of Exhibits" divider page sits before the exhibits;
 *   3. the exhibits are NOT listed as master-TOC entries (they live on the Index page);
 *   4. continuous Bates still applies.
 *
 * Uses synthetic PDFs + the REAL renderExhibitIndexForExhibits HTML + the REAL
 * compileExpedientePdf (no AI / Urlbox cost). Renders the master TOC + Index pages to PNG.
 *
 * Run:  npx -y tsx docs/_evidence/exhibits-ola1/toc-structure-e2e.ts
 */
import * as fs from "fs";
import * as path from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";

for (const line of fs.readFileSync(path.resolve(__dirname, "../../../.env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

async function makePdf(pages: number, label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`${label} — page ${i + 1}`, { x: 72, y: 700, size: 14, font });
  }
  return doc.save();
}

function pageChunk(allText: string, n: number): string {
  const start = allText.indexOf(`=== Page ${n} ===`);
  const next = allText.indexOf(`=== Page ${n + 1} ===`);
  if (start < 0) return "";
  return allText.slice(start, next < 0 ? undefined : next);
}

async function main() {
  const { compileExpedientePdf, extractPdfText, htmlToPdf } = await import("../../../src/backend/platform/pdf");
  const { buildExhibitIndexHtml } = await import("../../../src/backend/modules/exhibits/domain");

  // memo references exhibits inline (no duplicate table)
  const memoDoc = await PDFDocument.create();
  const f = await memoDoc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const p = memoDoc.addPage([612, 792]);
    p.drawText(`Credible-Fear Memorandum — page ${i + 1}`, { x: 72, y: 700, size: 14, font: f });
    if (i === 1) p.drawText("...as documented in Exhibit B-1, and held in Exhibit A-1...", { x: 72, y: 660, size: 11, font: f });
  }
  const memoPdf = await memoDoc.save();

  const indexPdf = await htmlToPdf(
    buildExhibitIndexHtml([
      { label: "A-1", source: "U.S. Supreme Court (Cardoza-Fonseca)", date: "1987", supports: "Well-founded fear standard" },
      { label: "B-1", source: "Human Rights Watch", date: "2024-01-11", supports: "State persecution pattern" },
    ]),
  );
  const exA1 = await makePdf(2, "Cardoza-Fonseca opinion");
  const exB1 = await makePdf(4, "HRW Venezuela report");

  const compileInput = [
    { bytes: memoPdf, mimeType: "application/pdf", title: "Credible-Fear Memorandum", includeInToc: true },
    { bytes: indexPdf, mimeType: "application/pdf", title: "Index of Exhibits", includeInToc: true },
    { bytes: exA1, mimeType: "application/pdf", title: "Exhibit A-1 — U.S. Supreme Court", includeInToc: false },
    { bytes: exB1, mimeType: "application/pdf", title: "Exhibit B-1 — Human Rights Watch", includeInToc: false },
  ];
  const compiled = await compileExpedientePdf(compileInput);
  const text = await extractPdfText(compiled.pdf);
  const p1 = pageChunk(text, 1); // master TOC page

  const checks = {
    masterIsEnglish: /Table of Contents/.test(p1) && !/Índice del expediente/.test(text),
    masterListsMemo: /Credible-Fear Memorandum/.test(p1),
    masterListsIndexEntry: /Index of Exhibits/.test(p1),
    masterOMITSexhibits: !/Exhibit A-1/.test(p1) && !/Exhibit B-1/.test(p1),
    indexPageExists: /Index of Exhibits/.test(text) && /Well-founded fear standard/.test(text),
    bates0001: /USALP-0001/.test(text),
    batesLast: new RegExp(`USALP-${String(compiled.pageCount).padStart(4, "0")}`).test(text),
  };

  console.log("== NEW expediente structure ==");
  console.log(`pages: ${compiled.pageCount}`);
  console.log(`master TOC entries: ${compiled.toc.map((t) => `${t.title}@${t.startPage}`).join(" | ")}`);
  for (const [k, v] of Object.entries(checks)) console.log(`  [${v ? "OK" : "FAIL"}] ${k}`);

  // render master TOC (p1) + the Index of Exhibits page for visual evidence
  const mupdf = await import("mupdf");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (mupdf as any).Document.openDocument(compiled.pdf, "application/pdf");
  const idxPageNum = compiled.toc.find((t) => t.title === "Index of Exhibits")?.startPage ?? 2;
  for (const [pg, name] of [[1, "new-p1-master-toc"], [idxPageNum, "new-index-of-exhibits"]] as [number, string][]) {
    const page = doc.loadPage(pg - 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pix = page.toPixmap((mupdf as any).Matrix.scale(1.4, 1.4), (mupdf as any).ColorSpace.DeviceRGB, false);
    fs.writeFileSync(path.resolve(__dirname, `${name}.png`), Buffer.from(pix.asPNG()));
  }

  const ok = Object.values(checks).every(Boolean);
  console.log(`\n==== ${ok ? "PASS" : "FAIL"} ====`);
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
