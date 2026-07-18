/* Render EOIR-26 pages 1 and 3 to PNG to inspect checkbox marks visually. */
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const buf = fs.readFileSync(path.join(__dirname, "eoir26-filled.pdf"));
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  for (const p of [0, 2]) {
    const page = doc.loadPage(p);
    const pix = page.toPixmap(mupdf.Matrix.scale(1.6, 1.6), mupdf.ColorSpace.DeviceRGB, false, true);
    fs.writeFileSync(path.join(__dirname, `eoir26-p${p + 1}.png`), pix.asPNG());
    console.log(`page ${p + 1} rendered`);
  }
})();
