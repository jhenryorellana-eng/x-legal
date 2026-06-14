/* mupdf (Artifex wasm engine) AcroForm detection + fill on real govt PDFs.
 * node docs/_evidence/f4-spike/mupdf-test.mjs
 */
import * as mupdf from "mupdf";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDFS = ["i-765", "i-360", "eoir-26"];
const read = (slug) => new Uint8Array(readFileSync(join(__dirname, "pdfs", `${slug}.pdf`)));

function detect(slug) {
  const doc = mupdf.PDFDocument.openDocument(read(slug), "application/pdf");
  const pageCount = doc.countPages();
  const byType = {};
  const sample = [];
  let total = 0;
  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const widgets = page.getWidgets();
    for (const w of widgets) {
      total++;
      let type = "?";
      let name = "?";
      try { type = w.getFieldType(); } catch {}
      try { name = w.getName(); } catch {}
      byType[type] = (byType[type] || 0) + 1;
      if (sample.length < 6) sample.push({ name: String(name).slice(0, 40), type, page: i + 1 });
    }
  }
  // XFA?
  let xfa = false;
  try {
    const acro = doc.getTrailer().get("Root").get("AcroForm");
    xfa = acro && acro.get("XFA") && !acro.get("XFA").isNull() ? true : false;
  } catch {}
  return { pageCount, total, byType, sample, xfa, doc };
}

function proveFill(slug, doc, firstTextName) {
  // find the first text widget and set a value, then save (mupdf keeps form interactive;
  // flatten via bake() if available)
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    for (const w of page.getWidgets()) {
      try {
        if (w.getName() === firstTextName) {
          w.setTextValue("USALATINO-SPIKE-OK");
          w.update();
        }
      } catch {}
    }
  }
  let baked = "n/a";
  try { doc.bake(); baked = "ok"; } catch (e) { baked = "no-bake(" + String(e).slice(0, 30) + ")"; }
  const out = doc.saveToBuffer("");
  const bytes = out.asUint8Array();
  writeFileSync(join(__dirname, `${slug}-mupdf-filled.pdf`), bytes);
  return { wrote: bytes.length, baked };
}

console.log("\n===== mupdf — AcroForm detection on real govt PDFs =====\n");
for (const slug of PDFS) {
  try {
    const r = detect(slug);
    const flag = r.total === 0 ? "  ⚠ 0 widgets" : r.xfa ? "  ⚠ XFA" : "  ✓";
    console.log(`${slug.toUpperCase()}: ${r.pageCount} págs · ${r.total} widgets · ${JSON.stringify(r.byType)} · xfa=${r.xfa}${flag}`);
    r.sample.forEach((s) => console.log(`    - ${JSON.stringify(s.name)} [${s.type}] page=${s.page}`));
    const firstText = r.sample.find((s) => s.type === "text");
    if (firstText && r.total > 0) {
      const f = proveFill(slug, r.doc, firstText.name);
      console.log(`    FILL: wrote ${f.wrote}b · bake=${f.baked}`);
    }
  } catch (e) {
    console.log(`${slug.toUpperCase()}: ERROR — ${String(e).slice(0, 160)}`);
  }
  console.log("");
}
