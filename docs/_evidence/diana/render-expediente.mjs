// Downloads the compiled expediente PDF (signed URL passed as argv[2]) and renders
// key pages to PNG + extracts Bates/TOC text. Run from repo root so `mupdf` resolves.
//   node docs/_evidence/diana/render-expediente.mjs "<signedUrl>"
import { writeFileSync } from "node:fs";

const url = process.argv[2];
if (!url) throw new Error("pass the signed URL as argv[2]");

const res = await fetch(url);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const bytes = new Uint8Array(await res.arrayBuffer());
console.log("downloaded bytes:", bytes.length);

const mupdf = await import("mupdf");
const doc = mupdf.Document.openDocument(bytes, "application/pdf");
const n = doc.countPages();
console.log("pageCount:", n);

const outDir = "docs/_evidence/diana";
const extra = (process.argv[3] || "").split(",").filter(Boolean).map((x) => parseInt(x, 10) - 1);
const renderPages = [...new Set([0, 1, n - 1, ...extra])]; // TOC, I-589 p1, last (Bates) + extra (1-based)
for (const i of renderPages) {
  const page = doc.loadPage(i);
  const pix = page.toPixmap(mupdf.Matrix.scale(1.6, 1.6), mupdf.ColorSpace.DeviceRGB, false);
  writeFileSync(`${outDir}/exp-p${i + 1}.png`, pix.asPNG());
}

// Text checks: TOC on page 1, Bates on every page.
const t1 = doc.loadPage(0).toStructuredText().asText();
const tLast = doc.loadPage(n - 1).toStructuredText().asText();
const t2 = doc.loadPage(1).toStructuredText().asText();
const bates = [...`${t1}\n${t2}\n${tLast}`.matchAll(/USALP-\d{4}/g)].map((m) => m[0]);
console.log("TOC-heading-on-p1:", /table of contents/i.test(t1) || /índice|contenido/i.test(t1));
console.log("bates-samples:", [...new Set(bates)].slice(0, 6).join(", ") || "(none found)");
console.log("p1-first-120:", t1.replace(/\s+/g, " ").slice(0, 120));
console.log("p2-first-120:", t2.replace(/\s+/g, " ").slice(0, 120));
