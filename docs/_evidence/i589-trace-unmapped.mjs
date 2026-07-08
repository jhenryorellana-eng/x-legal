/* Trazado: descarga la plantilla I-589, escribe en cada widget de texto de las págs 1-2 una
 * etiqueta legible = slug de su nombre, y renderiza para ver a qué item del formulario cae cada
 * campo genérico (TextField*, DateTimeField*). Solo lectura (no toca PROD).
 * node docs/_evidence/i589-trace-unmapped.mjs */
import * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const supa = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const SRC = "forms/e7f12a89-d1dd-4478-84f3-17afff5a0b8d/1781838665755-i-589.pdf";
const { data, error } = await supa.storage.from("catalog-assets").download(SRC);
if (error) { console.error("DL_FAIL", error.message); process.exit(2); }
const bytes = new Uint8Array(await data.arrayBuffer());

const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf");

// Short readable tag from the field name (drop the form1[0].#subform[x]. prefix).
function tag(name) {
  let s = name.replace(/^form1\[0\]\.#subform\[\d+\]\./, "").replace(/^NotMarried\[0\]\./, "SP·");
  s = s.replace(/PtAIILine/g, "L").replace(/PtAILine/g, "L").replace(/TextField/g, "TF").replace(/DateTimeField/g, "DT")
       .replace(/_PlaceofLastEntry/g, "-Place").replace(/_DateofLastEntry/g, "-EntryDt").replace(/_I94Number/g, "-I94")
       .replace(/_StatusofLastAdmission/g, "-Status").replace(/_ExpDateofAuthorizedStay/g, "-Exp")
       .replace(/_PreviousArrivalDate/g, "-PrevArr").replace(/_MiddleName/g, "-Mid").replace(/_ANumber/g, "-Anum")
       .replace(/_Specify/g, "-Spec").replace(/_AptNumber/g, "-Apt").replace(/_InCareOf/g, "-ICO")
       .replace(/_StreetNumandName/g, "-Street").replace(/_TelephoneNumbe/g, "-Tel").replace(/_AreaCode/g, "-Area")
       .replace(/_City/g, "-City").replace(/_State/g, "-St").replace(/_ZipCode/g, "-Zip").replace(/\[0\]$/, "");
  return s;
}

let n = 0;
for (let i = 0; i < 2; i++) {
  const page = doc.loadPage(i);
  const widgets = page.getWidgets();
  for (const w of widgets) {
    const name = w.getName?.() ?? "";
    const isText = (() => { try { return w.isText?.() ?? true; } catch { return true; } })();
    // only text-holding widgets (skip checkboxes/buttons)
    let ft = "";
    try { ft = w.getFieldType?.() ?? ""; } catch {}
    if (ft && /checkbox|button|radio/i.test(ft)) continue;
    try { w.setTextValue(tag(name)); n++; } catch {}
  }
}
try { doc.bake(); } catch {}
const out = doc.saveToBuffer("");
const filled = new Uint8Array(out.asUint8Array ? out.asUint8Array() : out);

const doc2 = mupdf.Document.openDocument(filled, "application/pdf");
for (const idx of [0, 1]) {
  const pix = doc2.loadPage(idx).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false);
  fs.writeFileSync(path.join(__dirname, `i589-trace-p${idx + 1}.png`), pix.asPNG());
}
console.log(`traced ${n} text widgets on pages 1-2 → i589-trace-p{1,2}.png`);
