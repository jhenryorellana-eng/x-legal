/* Downloads the production-generated filled I-589 (from Rosa's real client
 * submission, via generateFilledPdf) and renders pages 1-4 to confirm the autofill.
 * Usage: node docs/_evidence/a3-test/download-filled.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as mupdf from "mupdf";
const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/a3-test`;
const env = readFileSync(`${ROOT}/.env.local`, "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
const PATH = "case/0c252b12-7421-4cb9-aa68-9722b62c3903/forms/i-589-parte-a-informacion-personal-429ca2c0-2456-47e8-8a88-8b1ae814e45c.pdf";

const sb = createClient(URL, SERVICE, { auth: { persistSession: false } });
const { data, error } = await sb.storage.from("generated").download(PATH);
if (error || !data) { console.error("download failed:", error?.message); process.exit(1); }
const bytes = new Uint8Array(await data.arrayBuffer());
writeFileSync(`${OUT}/rosa-filled.pdf`, Buffer.from(bytes));

const doc = mupdf.Document.openDocument(bytes, "application/pdf");
for (const p of [0, 1, 2, 3]) {
  const pix = doc.loadPage(p).toPixmap(mupdf.Matrix.scale(2.3, 2.3), mupdf.ColorSpace.DeviceRGB, false);
  writeFileSync(`${OUT}/rosa-p${p + 1}.png`, Buffer.from(pix.asPNG()));
}
console.log("downloaded + rendered rosa-p1..p4.png (" + bytes.length + " bytes)");
