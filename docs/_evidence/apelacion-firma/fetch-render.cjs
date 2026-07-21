/* Descarga un output.pdf del bucket `generated` (por output_path) y renderiza sus
 * páginas a PNG para inspección visual. Uso: node fetch-render.cjs <objectPath> <prefix> */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../../..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null; };
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");

const OBJECT = process.argv[2]; // e.g. generated/runs/<id>/output.pdf
const PREFIX = process.argv[3] || "out";

(async () => {
  const res = await fetch(`${URL}/storage/v1/object/generated/${OBJECT}`, {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
  });
  if (!res.ok) { console.error("download failed", res.status, await res.text()); process.exit(1); }
  const buf = new Uint8Array(await res.arrayBuffer());
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const n = doc.countPages();
  for (let i = 0; i < n; i++) {
    const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false, true);
    const file = path.join(__dirname, `${PREFIX}-p${i + 1}.png`);
    fs.writeFileSync(file, Buffer.from(pix.asPNG()));
    console.log("wrote", file);
  }
  console.log("pages:", n);
})().catch((e) => { console.error(e); process.exit(1); });
