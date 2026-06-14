/* Debug reliable fill+flatten of XFA-hybrid I-765 so the value is VISIBLE in the
 * flattened output. Strategy: drop XFA → AcroForm authoritative → set value →
 * regenerate appearance → bake. node docs/_evidence/f4-spike/fill-debug.mjs
 */
import * as mupdf from "mupdf";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const buf = new Uint8Array(readFileSync(join(__dirname, "pdfs/i-765.pdf")));

const doc = mupdf.PDFDocument.openDocument(buf, "application/pdf");

// 1. Drop XFA so the static AcroForm appearance is authoritative (otherwise an
//    XFA-aware viewer ignores the AcroForm values we set).
let xfaDropped = false;
try {
  const acro = doc.getTrailer().get("Root").get("AcroForm");
  if (acro && acro.get("XFA") && !acro.get("XFA").isNull()) {
    acro.delete("XFA");
    xfaDropped = true;
  }
  // Ask viewers to (re)generate field appearances.
  acro.put("NeedAppearances", true);
} catch (e) {
  console.log("xfa/acro step error:", String(e).slice(0, 80));
}
console.log("XFA dropped:", xfaDropped);

// 2. Set a known text field + force appearance regeneration.
const TARGET = "form1[0].Page1[0].Line1a_FamilyName[0]";
let setOk = false, readBack = null;
for (let i = 0; i < doc.countPages(); i++) {
  const page = doc.loadPage(i);
  for (const w of page.getWidgets()) {
    if (w.getName() === TARGET) {
      w.setTextValue("GONZALEZ-SPIKE");
      w.update(); // regenerate appearance stream
      try { readBack = w.getValue ? w.getValue() : (w.getTextValue ? w.getTextValue() : null); } catch {}
      setOk = true;
    }
  }
}
console.log("field set:", setOk, "· readBack:", JSON.stringify(readBack));

// 3. Bake (flatten) form fields into page content.
let baked = "n/a";
try { doc.bake(); baked = "ok"; } catch (e) { baked = String(e).slice(0, 40); }
console.log("bake:", baked);

const out = doc.saveToBuffer("").asUint8Array();
writeFileSync(join(__dirname, "i-765-filled-v2.pdf"), out);

// 4. Round-trip: re-open, extract text, confirm visible.
const re = mupdf.PDFDocument.openDocument(out, "application/pdf");
let widgets = 0;
for (let i = 0; i < re.countPages(); i++) widgets += re.loadPage(i).getWidgets().length;
const txt = re.loadPage(0).toStructuredText().asText();
console.log("widgets after bake:", widgets);
console.log("value visible in flattened text:", txt.includes("GONZALEZ-SPIKE") ? "SÍ ✓" : "NO ✗");
