/**
 * Empirical field discovery for I-589 page 4 (Part A.III).
 * Renders two labeled versions of page 4 so we can read which physical cell each
 * AcroForm widget lands in (the authoritative method — v1 left the family table +
 * deceased checkboxes unmapped and has a known index collision):
 *   - text/date widgets filled with a compact tag of their field name
 *   - checkboxes toggled ON (to locate the "Deceased" boxes)
 * Also dumps the widget list sorted top→bottom/left→right with rects + types.
 *
 * Usage: node docs/_evidence/a3-test/discover-page4.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as mupdf from "mupdf";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/a3-test`;
const PAGE = 3; // physical page 4 (subform[4])

// compact tag from a full field name: "...TextField13[39]" -> "T13.39", "DateTimeField42[0]" -> "DT42", "TextField35[0]" -> "X35.0"
function tag(name) {
  const m = name.match(/([A-Za-z]+?)(\d+)?\[(\d+)\]$/);
  const leaf = name.split(".").pop();
  let t = leaf
    .replace(/^TextField13/, "T")
    .replace(/^TextField35/, "X")
    .replace(/^TextField/, "TF")
    .replace(/^DateTimeField/, "D")
    .replace(/^CheckBox/, "C")
    .replace(/\[(\d+)\]$/, ".$1");
  return t;
}

function render(fillMode, file) {
  const bytes = new Uint8Array(readFileSync(`${ROOT}/i-589.pdf`));
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  try {
    const acro = doc.getTrailer()?.get("Root")?.get("AcroForm");
    if (acro) { acro.delete("XFA"); acro.put("NeedAppearances", doc.newBoolean(true)); }
  } catch {}
  const page = doc.loadPage(PAGE);
  const widgets = page.getWidgets?.() ?? [];
  const list = [];
  for (const w of widgets) {
    const name = w.getName?.() ?? "";
    const ft = w.getFieldType?.() ?? "text";
    const rect = w.getBounds?.() ?? [0, 0, 0, 0];
    list.push({ tag: tag(name), name: name.split(".").pop(), ft, rect: rect.map((n) => Math.round(n)) });
    try {
      if (ft === "checkbox") { if (fillMode === "checks") w.toggle?.(); }
      else if (fillMode === "text") w.setTextValue?.(tag(name));
      w.update?.();
    } catch {}
  }
  try { doc.bake(); } catch {}
  const outBytes = doc.saveToBuffer("").asUint8Array();
  const fd = mupdf.Document.openDocument(outBytes, "application/pdf");
  const pix = fd.loadPage(PAGE).toPixmap(mupdf.Matrix.scale(3, 3), mupdf.ColorSpace.DeviceRGB, false);
  writeFileSync(file, Buffer.from(pix.asPNG()));
  return list;
}

const listText = render("text", `${OUT}/discover-text.png`);
render("checks", `${OUT}/discover-checks.png`);

// dump sorted list (top→bottom, then left→right) for cross-reference
const sorted = [...listText].sort((a, b) => (b.rect[3] - a.rect[3]) || (a.rect[0] - b.rect[0]));
const lines = sorted.map((w) => `${w.tag.padEnd(9)} ${w.ft.padEnd(9)} y0=${String(w.rect[1]).padStart(4)} x0=${String(w.rect[0]).padStart(4)}  (${w.name})`);
writeFileSync(`${OUT}/discover-widgets.txt`, `page 4 widgets: ${listText.length}\n` + lines.join("\n"));
console.log("page 4 widgets:", listText.length, "| checkboxes:", listText.filter((w) => w.ft === "checkbox").length);
console.log("wrote discover-text.png, discover-checks.png, discover-widgets.txt");
