/* eslint-disable */
// Downloads the compiled expediente PDF and renders key pages to PNG:
// TOC (index), the I-589 cover, the I-589 A.I page (real filled data), and a party cover.
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_URL") || get("SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const BUCKET = "expedientes";
const PDF_PATH = "case/35023394-b5b7-43cc-9111-5fcf865a9e6f/902dbc0f-edd3-40c7-b2c5-46ff2e26f031-a1.pdf";
const RENDER = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));

async function main() {
  const { data, error } = await sb.storage.from(BUCKET).download(PDF_PATH);
  if (error) throw error;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const pages = doc.countPages();
  console.log("pages:", pages, "bytes:", bytes.length);
  const idxs = RENDER.length ? RENDER : [0, 1, 2, 4];
  for (const idx of idxs) {
    if (idx < 0 || idx >= pages) continue;
    const page = doc.loadPage(idx);
    const pix = page.toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false);
    fs.writeFileSync(path.join(__dirname, `exp-page-${idx}.png`), Buffer.from(pix.asPNG()));
    console.log("wrote exp-page-" + idx + ".png");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
