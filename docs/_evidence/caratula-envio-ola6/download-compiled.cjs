/* Descarga el expediente compilado de Storage (bucket expedientes) para inspeccionar la hoja 1.
 * Uso: node docs/_evidence/caratula-envio-ola6/download-compiled.cjs <storagePath> <outPath> */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));
const ROOT = path.join(__dirname, "../../..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
(async () => {
  const storagePath = process.argv[2];
  const out = process.argv[3];
  const bucket = process.argv[4] || "expedientes";
  const { data, error } = await db.storage.from(bucket).download(storagePath);
  if (error || !data) { console.error("FAIL:", error?.message ?? "no data"); process.exit(1); }
  const buf = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(out, buf);
  console.log(`WROTE ${out} (${buf.length} bytes)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
