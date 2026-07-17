/* Inspección del PDF compilado del expediente de apelación (Valentina U26-000035).
 * Descarga el compiled_pdf_path del bucket `expedientes` y verifica:
 *  - carátula (título EOIR-26), página TOC ("Table of Contents"), Index of Exhibits
 *  - foliación Bates "USALP-" presente en la primera y última página
 * Uso:  node docs/_evidence/expediente-guidance/inspect-compiled.cjs
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../../..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));

const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null;
};
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const CASE_ID = "3adb5a48-0ff2-43c5-bab8-c84c5290137e";

(async () => {
  const { data: exp, error } = await db
    .from("expedientes")
    .select("compiled_pdf_path, page_count, status")
    .eq("case_id", CASE_ID)
    .eq("status", "compiled")
    .single();
  if (error || !exp?.compiled_pdf_path) { console.error("FAIL: no compiled expediente", error?.message); process.exit(1); }
  console.log("expediente:", exp.status, exp.page_count, "págs —", exp.compiled_pdf_path);

  const { data: blob, error: dlErr } = await db.storage.from("expedientes").download(exp.compiled_pdf_path);
  if (dlErr) { console.error("FAIL: download", dlErr.message); process.exit(1); }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  console.log("pdf bytes:", bytes.length);

  const { pathToFileURL } = require("url");
  const mupdf = await import(pathToFileURL(path.join(ROOT, "node_modules/mupdf/dist/mupdf.js")).href);
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const n = doc.countPages();
  console.log("pages:", n);

  const pageText = (i) => {
    const st = doc.loadPage(i).toStructuredText();
    return JSON.parse(st.asJSON()).blocks
      .flatMap((b) => (b.lines ?? []).map((l) => l.text))
      .join(" | ");
  };

  for (const i of [0, 1, 2, 3]) console.log(`\n--- page ${i + 1} ---\n${pageText(i).slice(0, 600)}`);
  console.log(`\n--- last page (${n}) ---\n${pageText(n - 1).slice(0, 400)}`);
})();
