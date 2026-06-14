/* Verify mupdf gives widget geometry (rect) AND that fill round-trips.
 * node docs/_evidence/f4-spike/mupdf-verify.mjs
 */
import * as mupdf from "mupdf";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => new Uint8Array(readFileSync(join(__dirname, p)));

// 1. Geometry on I-765
const doc = mupdf.PDFDocument.openDocument(read("pdfs/i-765.pdf"), "application/pdf");
console.log("\n=== I-765 widget geometry (first 5 with bounds) ===");
let shown = 0;
for (let i = 0; i < doc.countPages() && shown < 5; i++) {
  const page = doc.loadPage(i);
  for (const w of page.getWidgets()) {
    let rect = null;
    try { rect = w.getBounds ? w.getBounds() : (w.getRect ? w.getRect() : null); } catch {}
    if (!rect) { try { rect = w.getObject().get("Rect").asArray?.(); } catch {} }
    console.log(`  ${w.getName().slice(0, 38)} [${w.getFieldType()}] page=${i + 1} rect=${rect ? JSON.stringify(rect) : "?"}`);
    if (++shown >= 5) break;
  }
}

// 2. Round-trip: re-open the filled+baked PDF, confirm the text is baked into content
console.log("\n=== Round-trip: re-open i-765-mupdf-filled.pdf ===");
try {
  const filled = mupdf.PDFDocument.openDocument(read("i-765-mupdf-filled.pdf"), "application/pdf");
  let widgetsAfter = 0;
  for (let i = 0; i < filled.countPages(); i++) widgetsAfter += filled.loadPage(i).getWidgets().length;
  // extract page-1 text to confirm the spike value is present as flattened content
  const txt = filled.loadPage(0).toStructuredText().asText();
  const hasValue = txt.includes("USALATINO-SPIKE-OK");
  console.log(`  widgets after bake: ${widgetsAfter} (0 = aplanado a contenido)`);
  console.log(`  value 'USALATINO-SPIKE-OK' presente en texto de pág1: ${hasValue ? "SÍ ✓" : "no"}`);
} catch (e) {
  console.log("  ERROR re-open:", String(e).slice(0, 120));
}
