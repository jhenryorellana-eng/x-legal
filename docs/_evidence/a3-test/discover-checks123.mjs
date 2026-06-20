/**
 * Discovers the checkbox widgets on I-589 pages 1-3 (Part A.I / A.II) so each
 * SELECT option can be mapped to the CORRECT checkbox field empirically (Sex,
 * Marital status, every Yes/No). Dumps name+rect sorted by reading order and
 * renders each page with ALL checkboxes toggled so positions can be read against
 * the printed labels.
 *
 * Usage: node docs/_evidence/a3-test/discover-checks123.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as mupdf from "mupdf";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/a3-test`;

const bytes = new Uint8Array(readFileSync(`${ROOT}/i-589.pdf`));
const doc = mupdf.Document.openDocument(bytes, "application/pdf");
try {
  const acro = doc.getTrailer()?.get("Root")?.get("AcroForm");
  if (acro) { acro.delete("XFA"); acro.put("NeedAppearances", doc.newBoolean(true)); }
} catch {}

const lines = [];
for (const pi of [0, 1, 2]) {
  const page = doc.loadPage(pi);
  const cbs = [];
  for (const w of page.getWidgets?.() ?? []) {
    if ((w.getFieldType?.() ?? "") !== "checkbox") continue;
    const name = w.getName?.() ?? "";
    const r = (w.getBounds?.() ?? [0, 0, 0, 0]).map((n) => Math.round(n));
    cbs.push({ name: name.split(".").pop(), full: name, rect: r });
    try { w.toggle?.(); w.update?.(); } catch {}
  }
  cbs.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
  lines.push(`\n=== PAGE ${pi + 1} (${cbs.length} checkboxes) ===`);
  for (const c of cbs) lines.push(`  y=${String(c.rect[1]).padStart(4)} x=${String(c.rect[0]).padStart(4)}  ${c.name}`);
}
writeFileSync(`${OUT}/checks123.txt`, lines.join("\n"));

try { doc.bake(); } catch {}
const outBytes = doc.saveToBuffer("").asUint8Array();
const fd = mupdf.Document.openDocument(outBytes, "application/pdf");
for (const pi of [0, 1, 2]) {
  const pix = fd.loadPage(pi).toPixmap(mupdf.Matrix.scale(2.4, 2.4), mupdf.ColorSpace.DeviceRGB, false);
  writeFileSync(`${OUT}/checks-p${pi + 1}.png`, Buffer.from(pix.asPNG()));
}
console.log("wrote checks123.txt + checks-p1..p3.png");
