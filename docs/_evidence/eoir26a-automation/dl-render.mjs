/* Download an app-generated PDF from the `generated` bucket (service role) and
 * render pages to PNG for verification. Usage: node dl-render.mjs <storagePath> <outPrefix> [pages...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "../../..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const STORAGE_PATH = process.argv[2];
const OUT_PREFIX = process.argv[3] || "e2e";
const PAGES = (process.argv.slice(4).length ? process.argv.slice(4) : ["1", "2"]).map(Number);

const { data, error } = await db.storage.from("generated").download(STORAGE_PATH);
if (error) { console.error("download fail:", error.message); process.exit(1); }
const bytes = new Uint8Array(await data.arrayBuffer());
fs.writeFileSync(path.join(here, `${OUT_PREFIX}.pdf`), bytes);
const mupdf = await import("mupdf");
const doc = mupdf.Document.openDocument(bytes, "application/pdf");
for (const p of PAGES) {
  if (p < 1 || p > doc.countPages()) continue;
  const pix = doc.loadPage(p - 1).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
  fs.writeFileSync(path.join(here, `${OUT_PREFIX}-p${p}.png`), pix.asPNG());
}
console.log(`rendered ${bytes.length} bytes, ${doc.countPages()} pages`);
