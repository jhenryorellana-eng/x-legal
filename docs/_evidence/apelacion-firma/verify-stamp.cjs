/* Fase 0 visual verification — stamp a visible mark at the EOIR-26 /Sig widget rects
 * (#9 page 2, #12 page 5 — PDF-native bottom-left, from inspect-annots.cjs) using
 * pdf-lib, then render those pages to confirm the placement lands on the "Sign Here"
 * line. Also renders through mupdf fillAcroForm→bake first, to prove the pipeline.
 * Read-only vs the source PDF (downloaded from catalog-assets); writes PNGs here. */
const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL_BASE = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
const SOURCE = "forms/93512a98-b8a8-4673-b0aa-5d5cfb7b0202/1784158838694-EOIR-26.pdf";

// Authoritative signature rects from pdf-lib (PDF-native bottom-left).
const PLACEMENTS = [
  { page: 2, rect: [180.6, 241.92, 531.24, 310.56] }, // #9  Signature of Person Appealing
  { page: 5, rect: [184.32, 324.96, 527.4, 395.76] }, // #12 Proof of Service SIGN HERE
];
const PAD = 4;

(async () => {
  const res = await fetch(`${URL_BASE}/storage/v1/object/catalog-assets/${SOURCE}`, {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
  });
  if (!res.ok) { console.error("download failed", res.status); process.exit(1); }
  const source = new Uint8Array(await res.arrayBuffer());

  // Build a visible semi-transparent signature mark via mupdf (transparent bg, like a
  // real transparent signature PNG).
  const mupdf = await import("mupdf");
  const M = mupdf;
  const sigHtml =
    `<!DOCTYPE html><html><body style="margin:0">` +
    `<div style="width:300px;height:60px;background:rgba(200,0,0,0.45);color:#fff;` +
    `font-size:32px;font-weight:bold;text-align:center;line-height:60px;font-family:sans-serif">FIRMA</div>` +
    `</body></html>`;
  const sdoc = M.Document.openDocument(new TextEncoder().encode(sigHtml), "text/html");
  sdoc.layout(320, 84, 11);
  const spix = sdoc.loadPage(0).toPixmap(M.Matrix.scale(2, 2), M.ColorSpace.DeviceRGB, true);
  const sigPng = new Uint8Array(spix.asPNG());

  // Stamp with pdf-lib at PDF-native rects (replicating stampSignatureAtRects).
  const doc = await PDFDocument.load(source, { ignoreEncryption: true });
  const png = await doc.embedPng(sigPng);
  const iw = png.width, ih = png.height;
  const pages = doc.getPages();
  for (const pl of PLACEMENTS) {
    const page = pages[pl.page];
    const [x0, y0, x1, y1] = pl.rect;
    const boxW = Math.max(1, x1 - x0 - PAD * 2);
    const boxH = Math.max(1, y1 - y0 - PAD * 2);
    let drawW = boxW, drawH = (boxW * ih) / iw;
    if (drawH > boxH) { drawH = boxH; drawW = (boxH * iw) / ih; }
    const x = x0 + (x1 - x0 - drawW) / 2;
    const y = y0 + PAD;
    page.drawImage(png, { x, y, width: drawW, height: drawH });
  }
  const stamped = new Uint8Array(await doc.save());

  // Render the two stamped pages for visual inspection.
  const out = M.Document.openDocument(stamped, "application/pdf");
  for (const pageIdx of [2, 5]) {
    const pix = out.loadPage(pageIdx).toPixmap(M.Matrix.scale(1.6, 1.6), M.ColorSpace.DeviceRGB, false, true);
    const file = path.join(__dirname, `stamped-p${pageIdx}.png`);
    fs.writeFileSync(file, Buffer.from(pix.asPNG()));
    console.log("wrote", file);
  }
})();
