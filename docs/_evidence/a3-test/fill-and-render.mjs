/**
 * Faithful replication of platform/pdf.ts fillAcroForm (mupdf XFA-safe recipe) +
 * mupdf page render. Fills the v2-draft I-589 questions with DISTINCT invented
 * data and renders the physical page that holds the A.III employment/education/
 * residence widgets, so we can visually confirm each split question lands in its
 * own cell (position correctness).
 *
 * Usage: node docs/_evidence/a3-test/fill-and-render.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as mupdf from "mupdf";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/a3-test`;
mkdirSync(OUT, { recursive: true });

const questions = JSON.parse(readFileSync(`${ROOT}/docs/_evidence/_v2-structure.json`, "utf8"));

// --- DISTINCT, memorable invented values for A.III (matched by field-name suffix) ---
const A3 = {
  "TextField13[52]": "María Esperanza Rodríguez de Pérez",       // madre
  "TextField13[54]": "Carlos Alberto Pérez Gómez",               // padre
  "TextField13[0]": "Avenida Libertador 1023, Edif. Sol, Apt 4B",// última dir calle
  "TextField13[2]": "Caracas",                                   // última dir ciudad
  "TextField13[4]": "Distrito Capital",                          // última dir provincia
  "TextField13[6]": "Venezuela",                                 // última dir país
  "DateTimeField21[0]": "01/2018",                               // última dir desde
  "DateTimeField20[0]": "11/2022",                               // última dir hasta
  "TextField13[8]": "Calle Falcon 56, Quinta Las Flores",        // residencia calle
  "TextField13[10]": "Valencia",                                 // residencia ciudad
  "TextField13[12]": "Carabobo",                                 // residencia provincia
  "TextField13[14]": "Venezuela",                                // residencia país
  "DateTimeField22[0]": "06/2015",                               // residencia desde
  "DateTimeField23[0]": "12/2017",                               // residencia hasta
  "TextField13[24]": "Universidad de Carabobo",                  // educación nombre
  "TextField13[25]": "Universidad (Licenciatura)",               // educación tipo
  "TextField13[26]": "Valencia, Venezuela",                      // educación ubicación
  "DateTimeField32[0]": "09/2008",                               // educación desde
  "DateTimeField33[0]": "07/2013",                               // educación hasta
  "TextField13[39]": "Transporte ACME C.A., Av. Bolivar 200, Maracay", // empleo empleador
  "TextField13[40]": "Mecanico automotriz",                      // empleo ocupación
  "DateTimeField42[0]": "03/2014",                               // empleo desde
  "DateTimeField43[0]": "08/2022",                               // empleo hasta
};

// Generic plausible value for any non-A.III text/date/number question.
function genericValue(q) {
  const t = q.field_type;
  if (t === "checkbox") return true;
  if (t === "number") return "3";
  if (t === "date") return "06/1988";
  return "Ejemplo";
}

// Build the values map keyed by the FULL stored pdf_field_name (as fillAcroForm expects).
const values = {};
for (const q of questions) {
  if (!q.pdf_field_name) continue;
  let v = null;
  for (const [suffix, val] of Object.entries(A3)) {
    if (q.pdf_field_name.endsWith(suffix)) { v = val; break; }
  }
  values[q.pdf_field_name] = v ?? genericValue(q);
}

// ---- Faithful fillAcroForm (mupdf) ----
const bytes = new Uint8Array(readFileSync(`${ROOT}/i-589.pdf`));
const doc = mupdf.Document.openDocument(bytes, "application/pdf");

// Step 1: drop XFA, NeedAppearances
try {
  const acro = doc.getTrailer()?.get("Root")?.get("AcroForm");
  if (acro) { acro.delete("XFA"); acro.put("NeedAppearances", doc.newBoolean(true)); }
} catch (e) { console.warn("xfa drop:", e.message); }

// Step 2: fill per widget + locate the A.III page
const n = doc.countPages();
let filled = 0;
const a3Anchor = "TextField13[39]"; // empleador — anchor for the employment page
let a3Page = -1;
const pageHits = {}; // page -> count of A.III fields found
for (let i = 0; i < n; i++) {
  const page = doc.loadPage(i);
  const widgets = page.getWidgets?.() ?? [];
  for (const w of widgets) {
    const name = w.getName?.() ?? "";
    if (!(name in values)) continue;
    const val = values[name];
    const ft = w.getFieldType?.() ?? "text";
    try {
      if (ft === "checkbox") { if (val) w.toggle?.(); }
      else if (ft === "combobox" || ft === "radiobutton") w.setChoiceValue?.(String(val));
      else w.setTextValue?.(String(val));
      w.update?.();
      filled++;
    } catch (e) { /* skip */ }
    if (name.endsWith(a3Anchor)) a3Page = i;
    for (const suffix of Object.keys(A3)) {
      if (name.endsWith(suffix)) pageHits[i] = (pageHits[i] ?? 0) + 1;
    }
  }
}
console.log("pages:", n, "| widgets filled:", filled, "| A.III anchor page:", a3Page);
console.log("A.III field hits per page:", JSON.stringify(pageHits));

// Step 3: bake + save
try { doc.bake(); } catch (e) { console.warn("bake:", e.message); }
const outBytes = doc.saveToBuffer("").asUint8Array();
writeFileSync(`${OUT}/filled.pdf`, Buffer.from(outBytes));
console.log("wrote filled.pdf", outBytes.length, "bytes");

// ---- Render the A.III page (+ neighbours) to PNG, re-open the FILLED bytes ----
const filledDoc = mupdf.Document.openDocument(outBytes, "application/pdf");
const renderPages = [...new Set([a3Page, a3Page === -1 ? 4 : a3Page].filter((x) => x >= 0))];
const scale = mupdf.Matrix.scale(2.2, 2.2);
for (const p of renderPages) {
  const page = filledDoc.loadPage(p);
  const pix = page.toPixmap(scale, mupdf.ColorSpace.DeviceRGB, false);
  const png = pix.asPNG();
  const file = `${OUT}/page-${p + 1}-a3.png`;
  writeFileSync(file, Buffer.from(png));
  console.log("wrote", file);
}
