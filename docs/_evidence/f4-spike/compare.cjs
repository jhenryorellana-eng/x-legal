/* Compare AcroForm field detection across libs on the 3 real govt PDFs.
 * node docs/_evidence/f4-spike/compare.cjs
 */
const path = require("path");
const fs = require("fs");
const NM = path.join(__dirname, "../../../node_modules");
const PDFS = ["i-765", "i-360", "eoir-26"];
const read = (slug) => fs.readFileSync(path.join(__dirname, "pdfs", `${slug}.pdf`));

async function viaCantoo(slug) {
  const { PDFDocument } = require(path.join(NM, "@cantoo/pdf-lib"));
  const doc = await PDFDocument.load(read(slug), { ignoreEncryption: true, throwOnInvalidObject: false });
  const fields = doc.getForm().getFields();
  const byType = {};
  for (const f of fields) {
    const t = f.constructor.name.replace("PDF", "");
    byType[t] = (byType[t] || 0) + 1;
  }
  return { count: fields.length, byType, sample: fields.slice(0, 4).map((f) => f.getName()) };
}

async function viaMupdf(slug) {
  const mupdf = require(path.join(NM, "mupdf"));
  const buf = read(slug);
  const doc = mupdf.PDFDocument.openDocument(buf, "application/pdf");
  const pageCount = doc.countPages();
  let widgets = 0;
  const byType = {};
  const sample = [];
  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const ws = page.getWidgets ? page.getWidgets() : [];
    for (const w of ws) {
      widgets++;
      let t = "unknown";
      try { t = w.getFieldType ? w.getFieldType() : (w.fieldType || "?"); } catch {}
      byType[t] = (byType[t] || 0) + 1;
      if (sample.length < 4) {
        let name = "?";
        try { name = w.getName ? w.getName() : (w.getLabel ? w.getLabel() : "?"); } catch {}
        sample.push(name);
      }
    }
  }
  // detect XFA via trailer/Root AcroForm
  let xfa = false;
  try {
    const root = doc.getTrailer().get("Root");
    const acro = root.get("AcroForm");
    xfa = acro && acro.get("XFA") ? true : false;
  } catch {}
  return { pageCount, count: widgets, byType, sample, xfa };
}

(async () => {
  console.log("\n===== LIB COMPARISON — AcroForm detection on real govt PDFs =====\n");
  for (const slug of PDFS) {
    console.log(`### ${slug.toUpperCase()}`);
    try {
      const c = await viaCantoo(slug);
      console.log(`  @cantoo/pdf-lib: ${c.count} campos · ${JSON.stringify(c.byType)} · sample=${JSON.stringify(c.sample)}`);
    } catch (e) {
      console.log(`  @cantoo/pdf-lib: ERROR — ${String(e).slice(0, 120)}`);
    }
    try {
      const m = await viaMupdf(slug);
      console.log(`  mupdf:           ${m.count} widgets · ${JSON.stringify(m.byType)} · xfa=${m.xfa} · sample=${JSON.stringify(m.sample)}`);
    } catch (e) {
      console.log(`  mupdf:           ERROR — ${String(e).slice(0, 120)}`);
    }
    console.log("");
  }
})();
