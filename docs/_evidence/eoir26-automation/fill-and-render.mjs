/**
 * EOIR-26 automation evidence — fill the official AcroForm with the EXACT export
 * values configured in the eoir-26 automation and render pages to PNG, so a human
 * can verify that every radio/checkbox ticks the correct box (items #7/#8 were
 * documented as "crossed" in the v1 system — this proves the v2 mapping).
 *
 * Mirrors the XFA-safe recipe of src/backend/platform/pdf.ts#fillAcroForm
 * (drop XFA → NeedAppearances → set values → bake → save).
 *
 * Usage: node docs/_evidence/eoir26-automation/fill-and-render.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_PDF = "C:/Users/mauri/Documents/Trabajos/UsaLatinoPrime/documentos/EOIR-26.pdf";
const OUT_DIR = here;

// Field name → value, using the EXACT option values stored in form_questions.
const VALUES = {
  "1. List names and alien numbers": "PEREZ GOMEZ, Diego — A123-456-789",
  "2": "Respondent/Applicant",
  "3": "Detained",
  "4. Last hearing": "Immigration Court, Houston, TX",
  "5": "Merits proceedings appeal",
  "Date 5.1_af_date": "06/20/2026",
  "6": "TEST REASONS FOR APPEAL — specific findings of fact and conclusions of law being challenged.",
  "7": "Choice1", // configured as "Sí" — MUST tick the YES box of item #7
  "8": "Yes",     // configured as "Sí" — MUST tick the YES box of item #8
  "Print Name": "Diego Perez Gomez",
  "10. Name": "Diego Perez Gomez",
  "Street Address": "123 Main St",
  "Apartment or Room Number": "4B",
  "City State Zip Code": "Houston, TX 77002",
  "Telephone Number": "(305) 555-1234",
  "12. Name": "Diego Perez Gomez",
  "12. Copy of Notice to Appeal mailed/delivered to": "Office of the Chief Counsel, DHS-ICE",
  "12. Address": "126 Northpoint Dr, Houston, TX 77060",
  "12. Date_af_date": "07/15/2026",
  "12. No service needed": true,
  "General Instructions checkbox": true,
  "Receipt checkbox": true,
};

const mupdf = await import("mupdf");
const data = fs.readFileSync(SRC_PDF);
const doc = mupdf.Document.openDocument(data, "application/pdf");

// 1. Drop XFA + NeedAppearances (mirror of fillAcroForm)
try {
  const pdfDoc = doc;
  const trailer = pdfDoc.getTrailer?.();
  if (trailer) {
    const root = trailer.get("Root");
    const acro = root?.get("AcroForm");
    if (acro && !acro.isNull()) {
      if (acro.get("XFA") && !acro.get("XFA").isNull()) acro.delete("XFA");
      acro.put("NeedAppearances", true);
    }
  }
} catch (e) {
  console.warn("XFA/NeedAppearances step:", e.message);
}

// 2. Set values per widget (same switch as fillAcroForm)
let setCount = 0;
for (let i = 0; i < doc.countPages(); i++) {
  const page = doc.loadPage(i);
  for (const w of page.getWidgets()) {
    const name = w.getName?.() ?? "";
    if (!(name in VALUES)) continue;
    const val = VALUES[name];
    const fieldType = w.getFieldType?.();
    try {
      if (fieldType === "checkbox") {
        const wantOn = val === true || (typeof val === "string" && val !== "" && val !== "Off");
        const cur = w.getValue?.() ?? "Off";
        const isOn = cur !== "Off" && cur !== "";
        if (isOn !== wantOn) w.toggle?.();
      } else if (fieldType === "combobox" || fieldType === "radiobutton") {
        w.setChoiceValue?.(String(val));
      } else {
        w.setTextValue?.(String(val));
      }
      w.update?.();
      setCount++;
    } catch (e) {
      console.warn(`set ${name}:`, e.message);
    }
  }
}
console.log("widgets set:", setCount);

// 3. Bake (flatten) + save
doc.bake();
const outBytes = doc.saveToBuffer("").asUint8Array();
fs.writeFileSync(path.join(OUT_DIR, "eoir26-test-fill.pdf"), outBytes);

// 4. Render pages 1, 3, 6, 7 to PNG (zoom 2x ≈ 144dpi)
const rendered = mupdf.Document.openDocument(fs.readFileSync(path.join(OUT_DIR, "eoir26-test-fill.pdf")), "application/pdf");
for (const pageNum of [1, 2, 3, 6, 7]) {
  const page = rendered.loadPage(pageNum - 1);
  const pix = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
  fs.writeFileSync(path.join(OUT_DIR, `eoir26-test-p${pageNum}.png`), pix.asPNG());
  console.log(`rendered page ${pageNum}`);
}
console.log("done");
