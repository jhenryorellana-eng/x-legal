/* F4 close-the-loop: fill the official I-589 with Carlos's SUBMITTED answers.
 * Reuses the exact XFA-safe recipe from src/backend/platform/pdf.ts fillAcroForm
 * (drop XFA -> NeedAppearances -> setTextValue/setChoiceValue/toggle -> bake -> save).
 * The pdf_field_name -> value map was resolved server-side (client_answer + profile)
 * exactly like resolveBySource. node docs/_evidence/f4-editor/fill-i589.mjs
 */
import * as mupdf from "mupdf";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// pdf_field_name -> { value, type } resolved from the submitted response + profile.
const VALUES = {
  "form1[0].#subform[0].PtAILine4_LastName[0]": { v: "Ramírez", t: "text" },
  "form1[0].#subform[0].PtAILine5_FirstName[0]": { v: "Carlos", t: "text" },
  "form1[0].#subform[0].PtAILine6_MiddleName[0]": { v: "Verificado", t: "text" },
  "form1[0].#subform[0].DateTimeField6[0]": { v: "1985-06-20", t: "text" },
  "form1[0].#subform[0].TextField3[0]": { v: "San Salvador, El Salvador", t: "text" },
  "form1[0].#subform[0].TextField4[0]": { v: "El Salvador", t: "text" },
  "form1[0].#subform[0].TextField4[1]": { v: "Salvadoreña", t: "text" },
  "form1[0].#subform[0].PartALine9Sex[0]": { v: "Male", t: "choice" },
  "form1[0].#subform[0].Marital[0]": { v: "Single", t: "choice" },
  "form1[0].#subform[0].TextField5[0]": { v: "Español, inglés básico", t: "text" },
  "form1[0].#subform[0].PtAILine8_TelephoneNumber[0]": { v: "+13055550102", t: "text" },
  "form1[0].#subform[0].CheckBox3[0]": { v: true, t: "checkbox" },
  "form1[0].#subform[0].DateTimeField2[0]": { v: "2024-01-15", t: "text" },
  "form1[0].#subform[0].TextField4[4]": { v: "El Paso, Texas", t: "text" },
  "form1[0].#subform[0].TextField4[5]": { v: "Sin documentos (parole humanitario)", t: "text" },
  "form1[0].#subform[1].CheckBox5[0]": { v: true, t: "checkbox" },
  "form1[0].#subform[1].ChildrenCheckbox[0]": { v: true, t: "checkbox" },
  "form1[0].#subform[0].TextField7[0]": { v: "Colonia Escalón, Calle Principal #45, San Salvador, El Salvador.", t: "text" },
  "form1[0].#subform[0].TextField7[1]": { v: "2019-2023: San Salvador, El Salvador. 2024-presente: Houston, TX, EE.UU.", t: "text" },
  "form1[0].#subform[1].TextField8[0]": { v: "Como periodista, publiqué reportajes sobre corrupción gubernamental. Recibí amenazas de muerte, mi domicilio fue allanado y sufrí un atentado fallido del que escapé.", t: "text" },
  "form1[0].#subform[1].TextField9[0]": { v: "Temo ser asesinado si regreso. Los responsables siguen en el poder y han amenazado con matarme por mi trabajo periodístico.", t: "text" },
  "form1[0].#subform[0].CheckBox4[0]": { v: true, t: "checkbox" },
  "form1[0].#subform[1].CheckBox17[0]": { v: true, t: "checkbox" },
};

const bytes = new Uint8Array(readFileSync(join(__dirname, "i-589.pdf")));
const pdfDoc = mupdf.Document.openDocument(bytes, "application/pdf");

// Step 1: drop XFA so the AcroForm static layer is authoritative + NeedAppearances.
try {
  const acroForm = pdfDoc.getTrailer()?.get("Root")?.get("AcroForm");
  if (acroForm) {
    acroForm.delete("XFA");
    acroForm.put("NeedAppearances", true);
  }
} catch (e) { console.warn("xfa drop skipped:", e.message); }

// Step 2: fill fields by widget name.
let filled = 0;
const n = pdfDoc.countPages();
for (let i = 0; i < n; i++) {
  const page = pdfDoc.loadPage(i);
  const widgets = page.getWidgets?.() ?? [];
  for (const w of widgets) {
    const name = w.getName?.() ?? "";
    if (!(name in VALUES)) continue;
    const { v, t } = VALUES[name];
    try {
      if (t === "checkbox") { if (v) w.toggle?.(); }
      else if (t === "choice") { w.setChoiceValue?.(String(v)); }
      else { w.setTextValue?.(String(v)); }
      w.update?.();
      filled++;
    } catch (e) { console.warn("field err", name, e.message); }
  }
}

try { pdfDoc.bake(); } catch { /* non-fatal */ }
const out = pdfDoc.saveToBuffer("").asUint8Array();
writeFileSync(join(__dirname, "i-589-LLENADO.pdf"), out);
console.log(`Filled ${filled}/${Object.keys(VALUES).length} fields -> i-589-LLENADO.pdf (${out.length} bytes)`);
