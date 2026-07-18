/* Polls the asilo extraction status + ai_field cache warm for the E2E re-test.
 * Prints one line per state change; exits when extraction completed AND cache warmed
 * (or extraction failed). */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));
const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null; };
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const CASE_ID = "e2528124-7255-4156-a378-ab5cffbbcf77";

(async () => {
  let last = "";
  for (let i = 0; i < 40; i++) {
    const { data: docs } = await db.from("case_documents").select("id, original_filename").eq("case_id", CASE_ID);
    const asilo = (docs ?? []).find((d) => /asilo/i.test(d.original_filename));
    let line = "no-asilo-doc";
    if (asilo) {
      const { data: ext } = await db.from("document_extractions").select("status, progress, error").eq("case_document_id", asilo.id).maybeSingle();
      const p = ext?.progress;
      const parts = p && p.parts ? Object.keys(p.parts).length : 0;
      const { count: cacheCount } = await db.from("case_ai_field_cache").select("id", { count: "exact", head: true }).eq("case_id", CASE_ID);
      line = `ext=${ext?.status ?? "none"} chunks=${parts} cache=${cacheCount ?? 0}${ext?.error ? " err=" + ext.error.slice(0, 80) : ""}`;
      if (ext?.status === "completed" && (cacheCount ?? 0) > 0) { console.log("DONE " + line); return; }
      if (ext?.status === "failed") { console.log("FAILED " + line); process.exit(1); }
    }
    if (line !== last) { console.log(new Date().toISOString().slice(11, 19) + " " + line); last = line; }
    await new Promise((r) => setTimeout(r, 30000));
  }
  console.log("TIMEOUT sin completar");
  process.exit(1);
})();
