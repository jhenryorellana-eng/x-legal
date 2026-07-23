/* Extrae la hoja 1 de un PDF a un PDF de 1 página (mupdf graft). */
import { readFileSync, writeFileSync } from "node:fs";

(async () => {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  const pageIndex = Number(process.argv[4] ?? "0"); // 0-based
  const mupdf = await import("mupdf");
  const M = mupdf as unknown as { Document: { openDocument: (b: Uint8Array, t: string) => unknown }; PDFDocument: new () => { graftPage: (to: number, src: unknown, i: number) => void; saveToBuffer: (o: string) => { asUint8Array: () => Uint8Array } } };
  const src = M.Document.openDocument(readFileSync(inPath), "application/pdf");
  const dst = new M.PDFDocument();
  dst.graftPage(0, src, pageIndex);
  const out = Buffer.from(dst.saveToBuffer("").asUint8Array());
  writeFileSync(outPath, out);
  console.log(`WROTE ${outPath} (${out.length} bytes) — page ${pageIndex + 1}`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
