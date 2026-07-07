/* Renderiza páginas clave del I-589 generado a PNG para inspección visual. */
import * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, "karelis-i589-ola2.pdf")));
const doc = mupdf.Document.openDocument(bytes, "application/pdf");

const PAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // todas
const scale = 1.6;
const mtx = mupdf.Matrix.scale(scale, scale);
for (const p of PAGES) {
  const page = doc.loadPage(p - 1);
  const pix = page.toPixmap(mtx, mupdf.ColorSpace.DeviceRGB, false);
  fs.writeFileSync(path.join(__dirname, `karelis-p${p}.png`), pix.asPNG());
  console.log(`p${p}.png ok`);
}
