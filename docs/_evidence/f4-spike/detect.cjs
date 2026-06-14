/* F4 Ola-0 spike — AcroForm detection + fill against 3 real govt PDFs.
 * Proves the two pure functions that the catalog editor (pdf_automation) and the
 * runtime (generateFilledPdf) will rely on. Run: node docs/_evidence/f4-spike/detect.cjs
 */
const path = require("path");
const fs = require("fs");
const pdfLib = require(path.join(__dirname, "../../../node_modules/pdf-lib"));
const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFButton, PDFSignature, PDFName } = pdfLib;

const PDFS = ["i-765", "i-360", "eoir-26"];

/** Map a pdf-lib field instance to our normalized field_type. */
function fieldType(field) {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "dropdown";
  if (field instanceof PDFSignature) return "signature";
  if (field instanceof PDFButton) return "button";
  return "unknown";
}

/** Detect the page index (1-based) and rect of a field via its first widget. */
function widgetGeometry(doc, field) {
  try {
    const widgets = field.acroField.getWidgets();
    if (!widgets.length) return null;
    const w = widgets[0];
    const rect = w.getRectangle();
    // Find which page holds this widget by matching the page's annotation refs.
    const pages = doc.getPages();
    const wRef = field.acroField.dict.context.getObjectRef
      ? null
      : null; // ref lookup is brittle; match by page Annots scan instead
    for (let i = 0; i < pages.length; i++) {
      const annots = pages[i].node.Annots && pages[i].node.Annots();
      if (!annots) continue;
      for (let j = 0; j < annots.size(); j++) {
        const annotRef = annots.get(j);
        const annot = doc.context.lookup(annotRef);
        if (annot === w.dict) {
          return { page: i + 1, rect: [rect.x, rect.y, rect.width, rect.height] };
        }
      }
    }
    return { page: null, rect: [rect.x, rect.y, rect.width, rect.height] };
  } catch {
    return null;
  }
}

/** Does the AcroForm declare XFA (Adobe LiveCycle dynamic form)? */
function hasXFA(doc) {
  try {
    const acro = doc.catalog.lookup(PDFName.of("AcroForm"));
    if (!acro) return false;
    const xfa = acro.lookup(PDFName.of("XFA"));
    return !!xfa;
  } catch {
    return false;
  }
}

async function detect(slug) {
  const bytes = fs.readFileSync(path.join(__dirname, "pdfs", `${slug}.pdf`));
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const form = doc.getForm();
  const fields = form.getFields();
  const byType = {};
  const detected = fields.map((f) => {
    const t = fieldType(f);
    byType[t] = (byType[t] || 0) + 1;
    const geo = widgetGeometry(doc, f);
    return { name: f.getName(), type: t, page: geo?.page ?? null, rect: geo?.rect ?? null };
  });
  return { slug, pageCount: doc.getPageCount(), fieldCount: fields.length, byType, xfa: hasXFA(doc), detected };
}

/** Prove fill: set the first text field, flatten, re-save, re-open, confirm. */
async function proveFill(slug, firstTextName) {
  const bytes = fs.readFileSync(path.join(__dirname, "pdfs", `${slug}.pdf`));
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const field = form.getTextField(firstTextName);
  field.setText("USALATINO-SPIKE-OK");
  form.flatten();
  const out = await doc.save();
  fs.writeFileSync(path.join(__dirname, `${slug}-filled.pdf`), out);
  // Re-open the flattened PDF — form should now have 0 fields (flattened to content).
  const re = await PDFDocument.load(out, { ignoreEncryption: true });
  const reFields = re.getForm().getFields().length;
  return { wrote: out.length, flattenedFieldCount: reFields };
}

(async () => {
  console.log("\n========== F4 SPIKE — AcroForm detection (pdf-lib) ==========\n");
  let anyFail = false;
  for (const slug of PDFS) {
    try {
      const r = await detect(slug);
      const flag = r.fieldCount === 0 ? "  ⚠ NO ACROFORM FIELDS" : r.xfa ? "  ⚠ XFA present" : "  ✓";
      console.log(`${slug.toUpperCase()}: ${r.pageCount} págs · ${r.fieldCount} campos · tipos=${JSON.stringify(r.byType)} · xfa=${r.xfa}${flag}`);
      // sample first 6 fields with geometry
      r.detected.slice(0, 6).forEach((d) =>
        console.log(`    - ${JSON.stringify(d.name).slice(0, 50)} [${d.type}] page=${d.page} rect=${d.rect ? d.rect.map((n) => Math.round(n)).join(",") : "n/a"}`),
      );
      if (r.fieldCount === 0) anyFail = true;
      // prove fill on first text field
      const firstText = r.detected.find((d) => d.type === "text");
      if (firstText) {
        const fill = await proveFill(slug, firstText.name);
        console.log(`    FILL: wrote ${fill.wrote}b, flattened→${fill.flattenedFieldCount} fields (0 = aplanado OK)`);
      } else {
        console.log(`    FILL: (sin campos text para probar)`);
      }
    } catch (e) {
      anyFail = true;
      console.log(`${slug.toUpperCase()}: ERROR — ${String(e).slice(0, 160)}`);
    }
    console.log("");
  }
  console.log(`RESULT: ${anyFail ? "alguna detección requirió fallback (ver ⚠)" : "los 3 PDFs detectados y rellenados OK ✓"}\n`);
})();
