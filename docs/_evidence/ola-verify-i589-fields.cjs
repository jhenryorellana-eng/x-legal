/* eslint-disable */
// Inspect AcroForm widgets via mupdf to ground-truth filled field values.
const fs = require("fs");
const path = require("path");

async function main() {
  const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, "i589-filled.pdf")));
  const mupdf = await import("mupdf");
  const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf");
  const pages = doc.countPages();
  let total = 0;
  for (let i = 0; i < pages; i++) {
    const page = doc.loadPage(i);
    const widgets = page.getWidgets();
    for (const w of widgets) {
      total++;
      const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(w));
      if (total === 1) console.log("widget methods:", proto.join(", "));
      let name = "?", val = "?", ft = "?";
      try { name = w.getName(); } catch (e) { name = "ERRname:" + e.message; }
      try { val = w.getValue(); } catch (e) { val = "ERRval:" + e.message; }
      try { ft = w.getFieldType(); } catch (e) { ft = "ERRft:" + e.message; }
      if ((val && val !== "Off" && String(val).trim() !== "") || String(name).includes("ERR")) {
        console.log(`p${i+1} ft=${ft} name=${name} val=${JSON.stringify(val)}`);
      }
    }
  }
  console.log("total widgets:", total);
}
main().catch((e) => { console.error(e); process.exit(1); });
