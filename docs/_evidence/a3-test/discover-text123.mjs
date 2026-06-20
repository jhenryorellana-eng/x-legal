/**
 * Empirical discovery for I-589 pages 1-3 (Part A.I / A.II) TEXT fields: fills each
 * text/date widget with a compact tag of its field name and renders the page, so we
 * can read which physical box each AcroForm field is (to fix the original propose's
 * A.I/A.II mismaps, e.g. DOB landing in the wrong box). Dumps coords too.
 *
 * Usage: node docs/_evidence/a3-test/discover-text123.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as mupdf from "mupdf";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/a3-test`;

function tag(name) {
  const leaf = name.split(".").pop();
  return leaf
    .replace(/^PtAILine/, "AI")
    .replace(/^PtAIILine/, "AII")
    .replace(/^DateTimeField/, "DT")
    .replace(/^TextField/, "T")
    .replace(/^Child/, "C")
    .replace(/_[A-Za-z]+/g, "")
    .replace(/\[(\d+)\]$/, ".$1")
    .slice(0, 14);
}

const bytes = new Uint8Array(readFileSync(`${ROOT}/i-589.pdf`));
const doc = mupdf.Document.openDocument(bytes, "application/pdf");
try { const a = doc.getTrailer()?.get("Root")?.get("AcroForm"); if (a) { a.delete("XFA"); a.put("NeedAppearances", doc.newBoolean(true)); } } catch {}

const lines = [];
for (const pi of [0, 1, 2]) {
  const page = doc.loadPage(pi);
  const ws = [];
  for (const w of page.getWidgets?.() ?? []) {
    const ft = w.getFieldType?.() ?? "";
    if (ft === "checkbox") continue;
    const name = w.getName?.() ?? "";
    const r = (w.getBounds?.() ?? [0, 0, 0, 0]).map((n) => Math.round(n));
    ws.push({ leaf: name.split(".").pop(), rect: r });
    try { w.setTextValue?.(tag(name)); w.update?.(); } catch {}
  }
  ws.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
  lines.push(`\n=== PAGE ${pi + 1} (${ws.length} text/date) ===`);
  for (const w of ws) lines.push(`  y=${String(w.rect[1]).padStart(4)} x=${String(w.rect[0]).padStart(4)}  ${w.leaf}`);
}
writeFileSync(`${OUT}/text123.txt`, lines.join("\n"));
try { doc.bake(); } catch {}
const out = doc.saveToBuffer("").asUint8Array();
const fd = mupdf.Document.openDocument(out, "application/pdf");
for (const pi of [0, 1, 2]) {
  const pix = fd.loadPage(pi).toPixmap(mupdf.Matrix.scale(2.6, 2.6), mupdf.ColorSpace.DeviceRGB, false);
  writeFileSync(`${OUT}/text-p${pi + 1}.png`, Buffer.from(pix.asPNG()));
}
console.log("wrote text123.txt + text-p1..p3.png");
