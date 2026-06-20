/**
 * Verifies the rebuilt A.III mapping: fills EVERY pdf-mapped A.III question with a
 * compact tag derived from its own question label, then renders page 4. Reading the
 * render confirms each question's value lands in the correct physical cell.
 *
 * Usage: SBTOKEN=<token> node docs/_evidence/a3-test/verify-render.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as mupdf from "mupdf";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/a3-test`;
const PROJ = "uexxyokexcamyjcknxua";
const GID = "72bf4941-186d-480d-a36b-84329ac7acc5";

const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.SBTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
};

function compactTag(es) {
  // "Residencia 3 — ciudad" -> "Res3 ciudad" ; keep section+row+last token
  let s = es.replace(/\(.*?\)/g, "").replace(/—/g, "-").replace(/\s+/g, " ").trim();
  s = s
    .replace(/Última dirección.*persecución/i, "Pers")
    .replace(/Última dirección.*/i, "UltDir")
    .replace(/Residencia (\d+).*?-\s*/i, "Res$1-")
    .replace(/Educación (\d+).*?-\s*/i, "Edu$1-")
    .replace(/Empleo (\d+).*?-\s*/i, "Emp$1-")
    .replace(/Hermano\/a (\d+).*?-\s*/i, "Herm$1-")
    .replace(/Madre.*?-?\s*/i, "Madre-")
    .replace(/Padre.*?-?\s*/i, "Padre-");
  return s.slice(0, 20);
}

const rows = await q(
  `select pdf_field_name name, field_type, question_i18n->>'es' es from form_questions where group_id='${GID}' and pdf_field_name is not null;`,
);
const values = {};
for (const r of rows) values[r.name] = r.field_type === "checkbox" ? true : compactTag(r.es);
console.log("pdf-mapped A.III questions:", rows.length);

const bytes = new Uint8Array(readFileSync(`${ROOT}/i-589.pdf`));
const doc = mupdf.Document.openDocument(bytes, "application/pdf");
try {
  const acro = doc.getTrailer()?.get("Root")?.get("AcroForm");
  if (acro) { acro.delete("XFA"); acro.put("NeedAppearances", doc.newBoolean(true)); }
} catch {}
let filled = 0, missing = [];
const present = new Set();
for (let i = 0; i < doc.countPages(); i++) {
  const page = doc.loadPage(i);
  for (const w of page.getWidgets?.() ?? []) {
    const name = w.getName?.() ?? "";
    if (!(name in values)) continue;
    present.add(name);
    const ft = w.getFieldType?.() ?? "text";
    try {
      if (ft === "checkbox") { if (values[name]) w.toggle?.(); }
      else w.setTextValue?.(String(values[name]));
      w.update?.();
      filled++;
    } catch {}
  }
}
for (const r of rows) if (!present.has(r.name)) missing.push(r.name);
try { doc.bake(); } catch {}
const outBytes = doc.saveToBuffer("").asUint8Array();
const fd = mupdf.Document.openDocument(outBytes, "application/pdf");
const pix = fd.loadPage(3).toPixmap(mupdf.Matrix.scale(2.6, 2.6), mupdf.ColorSpace.DeviceRGB, false);
writeFileSync(`${OUT}/verify-page4.png`, Buffer.from(pix.asPNG()));
console.log("filled:", filled, "| missing widgets (mapped in DB but not found in PDF):", missing.length, missing);
