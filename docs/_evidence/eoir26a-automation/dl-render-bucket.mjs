import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "../../..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const [BUCKET, STORAGE_PATH, OUT_PREFIX, ...pages] = process.argv.slice(2);
const PAGES = (pages.length ? pages : ["1","2"]).map(Number);
const { data, error } = await db.storage.from(BUCKET).download(STORAGE_PATH);
if (error) { console.error("download fail:", error.message); process.exit(1); }
const bytes = new Uint8Array(await data.arrayBuffer());
const mupdf = await import("mupdf");
const doc = mupdf.Document.openDocument(bytes, "application/pdf");
for (const p of PAGES) {
  if (p < 1 || p > doc.countPages()) continue;
  const pix = doc.loadPage(p - 1).toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false, true);
  fs.writeFileSync(path.join(here, `${OUT_PREFIX}-p${p}.png`), pix.asPNG());
}
console.log(`rendered ${bytes.length} bytes, ${doc.countPages()} pages`);
