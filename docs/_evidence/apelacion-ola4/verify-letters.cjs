/* Descarga los PDFs generados (Statement + Proof) del bucket `generated`, extrae
 * su texto y renderiza cada página a PNG — para verificar SIN espacios en blanco
 * (dirección del apelante, OCC, método marcado, firma, fecha). */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const ROOT = path.join(__dirname, "../../..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null; };
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(URL, SVC, { auth: { persistSession: false } });

const CASE = "e2528124-7255-4156-a378-ab5cffbbcf77";
const PHASE = "f62fafe4-f5ef-49ac-9565-919d8c2a3ce1";
const OUT = process.argv[2] || __dirname;

(async () => {
  const mupdf = await import(pathToFileURL(path.join(ROOT, "node_modules/mupdf/dist/mupdf.js")).href);
  for (const slug of ["statement-of-reasons-for-appeal", "proof-of-service"]) {
    const { data: fd } = await db.from("form_definitions").select("id").eq("service_phase_id", PHASE).eq("slug", slug).single();
    const { data: run } = await db.from("ai_generation_runs").select("id, status, created_at").eq("case_id", CASE).eq("form_definition_id", fd.id).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const objectPath = run ? `generated/runs/${run.id}/output.pdf` : null;
    console.log(`\n######### ${slug} — run=${run?.status || "NONE"} path=${objectPath || "NONE"} #########`);
    if (!objectPath) continue;
    const res = await fetch(`${URL}/storage/v1/object/generated/${objectPath}`, { headers: { Authorization: `Bearer ${SVC}`, apikey: SVC } });
    if (!res.ok) { console.log("download fail", res.status); continue; }
    const buf = new Uint8Array(await res.arrayBuffer());
    const doc = mupdf.Document.openDocument(buf, "application/pdf");
    const n = doc.countPages();
    console.log("pages:", n);
    for (let p = 0; p < n; p++) {
      const st = doc.loadPage(p).toStructuredText("preserve-whitespace");
      const txt = JSON.parse(st.asJSON()).blocks.flatMap((b) => (b.lines || []).map((l) => l.text)).join("\n");
      console.log(`--- ${slug} PAGE ${p + 1} ---\n` + txt);
      const pix = doc.loadPage(p).toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false, true);
      fs.writeFileSync(path.join(OUT, `${slug}-ola4-p${p + 1}.png`), Buffer.from(pix.asPNG()));
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
