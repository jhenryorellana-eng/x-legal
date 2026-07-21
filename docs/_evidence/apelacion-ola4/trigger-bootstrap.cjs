/* Dispara el autoBootstrap de cuestionarios (statement + proof) para U26-000038:
 * re-extrae el documento DECISIÓN (pequeño) por el webhook loopback local, lo que
 * re-emite extraction.completed → autoBootstrapCaseQuestionnaires. El job salta si
 * la extracción ya está completed (service.ts:1441), así que primero la borramos. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const ROOT = path.join(__dirname, "../../..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null; };
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const DECISION_DOC_ID = "a2c7eed2-639a-4b01-9005-1b5ab8a09361";
const CASE_ID = "e2528124-7255-4156-a378-ab5cffbbcf77";
const SIGNING_KEY = get("QSTASH_CURRENT_SIGNING_KEY");
const token = crypto.createHmac("sha256", SIGNING_KEY).update("local-job-dispatch/v1").digest("hex");

(async () => {
  // 1. Borrar la extracción de la decisión para forzar re-extracción.
  const del = await db.from("document_extractions").delete().eq("case_document_id", DECISION_DOC_ID);
  if (del.error) { console.error("delete extraction:", del.error.message); process.exit(1); }
  console.log("OK  extracción de la decisión borrada (forzar re-run)");

  // 2. POST del job al webhook loopback.
  const payload = {
    jobKey: "extract-document", entityId: DECISION_DOC_ID, attempt: 1,
    dedupeId: "extract-document:" + DECISION_DOC_ID, caseDocumentId: DECISION_DOC_ID,
  };
  const res = await fetch("http://127.0.0.1:3100/api/webhooks/qstash/extract-document", {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-job-dispatch": token },
    body: JSON.stringify(payload),
  });
  console.log("POST extract-document ->", res.status, (await res.text()).slice(0, 200));

  // 3. Poll: esperar a que aparezcan las instancias de cuestionario.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { data } = await db.from("case_questionnaire_instances")
      .select("form_definition_id, status, draft_answers")
      .eq("case_id", CASE_ID).eq("is_current", true);
    const rows = data ?? [];
    const ext = await db.from("document_extractions").select("status").eq("case_document_id", DECISION_DOC_ID).maybeSingle();
    console.log(`  [${i}] decision_ext=${ext.data?.status ?? "none"} · instances=${rows.length} · ${rows.map(r => r.status + (r.draft_answers ? "+drafts" : "")).join(", ")}`);
    if (rows.length >= 2 && rows.every((r) => ["ready", "failed"].includes(r.status))) { console.log("DONE"); return; }
  }
  console.log("TIMEOUT esperando instancias");
})().catch((e) => { console.error(e); process.exit(1); });
