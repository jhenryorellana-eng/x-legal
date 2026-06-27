/* eslint-disable */
// Downloads the generated filled I-589 (Part A) PDF and renders pages to PNG
// to visually verify the client's answers landed in the correct AcroForm fields.
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_URL") || get("SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const BUCKET = "generated";
const PDF_PATH = "case/35023394-b5b7-43cc-9111-5fcf865a9e6f/forms/i-589-parte-a-informacion-personal-11a5961e-9d25-46f9-963f-8b2ca106a1e9.pdf";

async function main() {
  const { data, error } = await sb.storage.from(BUCKET).download(PDF_PATH);
  if (error) throw error;
  const bytes = new Uint8Array(await data.arrayBuffer());
  fs.writeFileSync(path.join(__dirname, "i589-filled.pdf"), Buffer.from(bytes));
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const pages = doc.countPages();
  console.log("pages:", pages, "bytes:", bytes.length);
  for (let idx = 0; idx < pages; idx++) {
    const page = doc.loadPage(idx);
    const pix = page.toPixmap(mupdf.Matrix.scale(1.6, 1.6), mupdf.ColorSpace.DeviceRGB, false);
    const png = pix.asPNG();
    const out = path.join(__dirname, `i589-page-${idx}.png`);
    fs.writeFileSync(out, Buffer.from(png));
    console.log("wrote", out);
    // Also dump page text to confirm filled values are present in content
    const text = page.toStructuredText("preserve-whitespace").asText();
    console.log(`--- page ${idx} text (first 1200 chars) ---`);
    console.log(text.slice(0, 1200));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
