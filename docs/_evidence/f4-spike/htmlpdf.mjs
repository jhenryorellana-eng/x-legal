/* Can mupdf render HTML→PDF? (would unify form-fill + generation render on ONE engine) */
import * as mupdf from "mupdf";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));

const html = `<html><body style="font-family:serif"><h1>Memorándum de Asilo</h1>
<p>Este es un <b>párrafo</b> de prueba con una lista:</p>
<ul><li>Punto uno</li><li>Punto dos</li></ul></body></html>`;

try {
  const buf = new TextEncoder().encode(html);
  const htmlDoc = mupdf.Document.openDocument(buf, "text/html");
  htmlDoc.layout(612, 792, 11); // US Letter pts, 11pt font
  const n = htmlDoc.countPages();
  // Write to PDF: mupdf can convert any Document to PDF via PDFDocument.
  let pdfBytes = null, how = "?";
  try {
    const pdf = htmlDoc.toPDFDocument ? htmlDoc.toPDFDocument() : null;
    if (pdf) { pdfBytes = pdf.saveToBuffer("").asUint8Array(); how = "toPDFDocument"; }
  } catch (e) { how = "toPDFDocument-fail:" + String(e).slice(0, 50); }
  if (!pdfBytes) {
    // fallback: use the document writer API
    try {
      const writer = new mupdf.DocumentWriter(mupdf.Buffer ? new mupdf.Buffer() : undefined, "pdf", "");
      for (let i = 0; i < n; i++) {
        const page = htmlDoc.loadPage(i);
        const dev = writer.beginPage(page.getBounds());
        page.run(dev, mupdf.Matrix.identity);
        writer.endPage();
      }
      writer.close();
      how = "DocumentWriter";
    } catch (e) { how += " | writer-fail:" + String(e).slice(0, 50); }
  }
  console.log(`html opened: pages=${n} · pdf=${how}${pdfBytes ? " bytes=" + pdfBytes.length : ""}`);
  if (pdfBytes) writeFileSync(join(__dirname, "memo-test.pdf"), pdfBytes);
  console.log("Document methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(htmlDoc)).filter((m) => /pdf|save|write|bake|run/i.test(m)).join(","));
} catch (e) {
  console.log("html→pdf ERROR:", String(e).slice(0, 160));
}
