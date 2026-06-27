/* eslint-disable */
// Downloads the compiled expediente PDF and renders two cover pages to PNG.
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_URL") || get("SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const PDF_PATH = "case/35023394-b5b7-43cc-9111-5fcf865a9e6f/d0b0272b-bf60-4a5b-aa7e-4a5da614c641-a1.pdf";

async function main() {
  const { data, error } = await sb.storage.from("expedientes").download(PDF_PATH);
  if (error) throw error;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const pages = doc.countPages();
  console.log("pages:", pages);
  for (const idx of [1, 5]) {
    if (idx >= pages) continue;
    const page = doc.loadPage(idx);
    const pix = page.toPixmap(mupdf.Matrix.scale(1.4, 1.4), mupdf.ColorSpace.DeviceRGB, false);
    const png = pix.asPNG();
    const out = path.join(__dirname, `cover-page-${idx}.png`);
    fs.writeFileSync(out, Buffer.from(png));
    console.log("wrote", out);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
