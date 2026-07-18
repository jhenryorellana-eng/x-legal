/* Reset PARCIAL del caso de prueba U26-000038 (clienta Ivis, Apelación BIA) — PROD.
 *
 * Objetivo (Henry 2026-07-18): dejar el caso "recién activado" para re-testear el
 * flujo completo desde la subida de documentos. SE CONSERVA: usuario, caso,
 * contrato, plan de pago/pagos, conversación/mensajes, citas. SE BORRA: documentos
 * (+extracciones/traducciones en cascada), respuestas de formularios, instancias
 * de cuestionario, generaciones IA, exhibits, expediente (+items), covers, hilos
 * Lex + knowledge chunks, pre-mortems, caché ai_field — y sus archivos de Storage.
 * Al final: cases.current_stage='sales', status='active', owner = asesora.
 *
 * Trampas cubiertas (runbook 2026-07-17-limpieza-casos-demo-apelacion.md):
 *  - Storage ANTES que BD, vía Storage API (borrar filas por SQL deja binarios huérfanos).
 *  - Paths que NO llevan el case_id (generated/runs/<run_id>/…) se resuelven por
 *    columnas de la BD, filtrando por case_id ANTES de borrar las filas.
 *  - EXCLUIDOS del manifiesto: contracts.signature_image_path y payments.zelle_proof_path.
 *  - No se tocan tablas con triggers de inmutabilidad (timeline/history/messages/audit
 *    se CONSERVAN) → no hace falta deshabilitar triggers ni transacción SQL cruda.
 *
 * Uso:
 *   node docs/_evidence/prod-cleanup/reset-case-e2528124.cjs            # dry-run (conteos + manifiesto)
 *   node docs/_evidence/prod-cleanup/reset-case-e2528124.cjs --apply    # ejecuta [REQUIERE OK DE HENRY]
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "../../..");
const { createClient } = require(path.join(REPO, "node_modules/@supabase/supabase-js"));

const env = {};
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const APPLY = process.argv.includes("--apply");
const CASE_ID = "e2528124-7255-4156-a378-ab5cffbbcf77"; // U26-000038

const die = (step, msg) => { console.error(`FAIL [${step}]: ${msg}`); process.exit(1); };
const ok = (step, extra = "") => console.log(`OK   [${step}] ${extra}`);

async function rows(table, select, filter) {
  let q = db.from(table).select(select);
  q = filter(q);
  const { data, error } = await q;
  if (error) die(`select-${table}`, error.message);
  return data ?? [];
}

async function main() {
  const caseRow = (await rows("cases", "id, case_number, status, current_stage, assigned_sales_id", (q) => q.eq("id", CASE_ID)))[0];
  if (!caseRow) die("case", `caso ${CASE_ID} no existe`);
  ok("case", `${caseRow.case_number} status=${caseRow.status} stage=${caseRow.current_stage}`);

  // ── 1. Manifiesto de Storage (por columnas de BD, filtrado por case_id) ─────
  const docs = await rows("case_documents", "id, storage_path", (q) => q.eq("case_id", CASE_ID));
  const docIds = docs.map((d) => d.id);
  const runs = await rows("ai_generation_runs", "id, output_path", (q) => q.eq("case_id", CASE_ID));
  const responses = await rows("case_form_responses", "id, filled_pdf_path", (q) => q.eq("case_id", CASE_ID));
  const covers = await rows("cover_renders", "id, pdf_path", (q) => q.eq("case_id", CASE_ID));
  const exhibits = await rows("case_exhibits", "id, pdf_path", (q) => q.eq("case_id", CASE_ID));
  const expedientes = await rows("expedientes", "id, compiled_pdf_path", (q) => q.eq("case_id", CASE_ID));
  const translations = docIds.length
    ? await rows("document_translations", "id, translated_pdf_path, case_document_id", (q) => q.in("case_document_id", docIds))
    : [];

  const manifest = { "case-documents": [], generated: [], expedientes: [] };
  const add = (bucket, p) => { if (p && typeof p === "string") manifest[bucket].push(p); };
  for (const d of docs) add("case-documents", d.storage_path);
  for (const r of runs) add("generated", r.output_path);
  for (const r of responses) add("generated", r.filled_pdf_path);
  for (const c of covers) add("generated", c.pdf_path);
  for (const t of translations) add("generated", t.translated_pdf_path);
  for (const x of exhibits) add("expedientes", x.pdf_path);
  for (const e of expedientes) add("expedientes", e.compiled_pdf_path);

  // Conteos de tablas a borrar (dry-run visibility).
  const countOf = async (table, filter) => {
    let q = db.from(table).select("id", { count: "exact", head: true });
    q = filter(q);
    const { count, error } = await q;
    if (error) return `err:${error.message}`;
    return count ?? 0;
  };
  const counts = {
    case_documents: docs.length,
    document_extractions: docIds.length ? await countOf("document_extractions", (q) => q.in("case_document_id", docIds)) : 0,
    document_translations: translations.length,
    case_form_responses: responses.length,
    case_questionnaire_instances: await countOf("case_questionnaire_instances", (q) => q.eq("case_id", CASE_ID)),
    ai_generation_runs: runs.length,
    case_exhibits: exhibits.length,
    expediente_items: expedientes.length
      ? await countOf("expediente_items", (q) => q.in("expediente_id", expedientes.map((e) => e.id)))
      : 0,
    expedientes: expedientes.length,
    cover_renders: covers.length,
    case_pre_mortem_assessments: await countOf("case_pre_mortem_assessments", (q) => q.eq("case_id", CASE_ID)),
    case_lex_threads: await countOf("case_lex_threads", (q) => q.eq("case_id", CASE_ID)),
    case_knowledge_chunks: await countOf("case_knowledge_chunks", (q) => q.eq("case_id", CASE_ID)),
    case_ai_field_cache: await countOf("case_ai_field_cache", (q) => q.eq("case_id", CASE_ID)),
  };

  console.log("\n=== RESET PLAN (caso " + caseRow.case_number + ") ===");
  console.log("Storage:", Object.fromEntries(Object.entries(manifest).map(([b, xs]) => [b, xs.length])));
  console.log("Tablas:", counts);
  console.log("Se conserva: users, cases, contracts, payment_plans/installments/payments, conversations/messages, appointments, timeline/history.");
  console.log("Estado final: current_stage='sales', status='active'.");

  if (!APPLY) {
    fs.writeFileSync(path.join(__dirname, "reset-manifest-preview.json"), JSON.stringify(manifest, null, 2));
    console.log("\nDRY-RUN — nada borrado. Manifiesto en reset-manifest-preview.json. Ejecuta con --apply tras el OK de Henry.");
    return;
  }

  // ── 2. Storage primero ─────────────────────────────────────────────────────
  let removed = 0, errs = 0;
  for (const [bucket, names] of Object.entries(manifest)) {
    for (let i = 0; i < names.length; i += 50) {
      const batch = names.slice(i, i + 50);
      const { data, error } = await db.storage.from(bucket).remove(batch);
      if (error) { errs += batch.length; console.error(`[${bucket}] ERROR ${error.message}`); }
      else { removed += data.length; console.log(`[${bucket}] removed ${data.length}/${batch.length}`); }
    }
  }
  ok("storage", `removed=${removed} errors=${errs}`);
  if (errs > 0) die("storage", "errores borrando storage — NO se tocó la BD; corrige y reintenta");

  // ── 3. BD en orden FK-seguro (deletes idempotentes, re-ejecutables) ────────
  const del = async (table, filter) => {
    let q = db.from(table).delete();
    q = filter(q);
    const { error } = await q;
    if (error) die(`delete-${table}`, error.message);
    ok(`delete-${table}`);
  };
  await del("case_pre_mortem_assessments", (q) => q.eq("case_id", CASE_ID));
  await del("case_lex_threads", (q) => q.eq("case_id", CASE_ID)); // mensajes lex via CASCADE
  await del("case_knowledge_chunks", (q) => q.eq("case_id", CASE_ID));
  if (expedientes.length) await del("expediente_items", (q) => q.in("expediente_id", expedientes.map((e) => e.id)));
  await del("expedientes", (q) => q.eq("case_id", CASE_ID));
  await del("case_exhibits", (q) => q.eq("case_id", CASE_ID));
  await del("cover_renders", (q) => q.eq("case_id", CASE_ID));
  await del("ai_generation_runs", (q) => q.eq("case_id", CASE_ID));
  await del("case_form_responses", (q) => q.eq("case_id", CASE_ID));
  await del("case_questionnaire_instances", (q) => q.eq("case_id", CASE_ID));
  await del("case_ai_field_cache", (q) => q.eq("case_id", CASE_ID));
  // extracciones + traducciones caen por CASCADE de case_documents:
  await del("case_documents", (q) => q.eq("case_id", CASE_ID));

  // ── 4. Estado del caso: recién activado, en manos de la asesora ────────────
  const { error: eUpd } = await db.from("cases").update({
    current_stage: "sales",
    status: "active",
    current_owner_id: caseRow.assigned_sales_id ?? null,
    stage_entered_at: new Date().toISOString(),
    completed_at: null,
  }).eq("id", CASE_ID);
  if (eUpd) die("case-update", eUpd.message);
  ok("case-update", "stage=sales status=active");

  // ── 5. Verificación post ───────────────────────────────────────────────────
  const post = {};
  for (const t of ["case_documents", "case_form_responses", "case_questionnaire_instances", "ai_generation_runs", "case_exhibits", "expedientes", "cover_renders", "case_pre_mortem_assessments", "case_lex_threads", "case_knowledge_chunks", "case_ai_field_cache"]) {
    post[t] = await countOf(t, (q) => q.eq("case_id", CASE_ID));
  }
  // Extracciones/traducciones caen por CASCADE de case_documents — verificación
  // independiente por los ids de documentos que existían antes del borrado.
  if (docIds.length) {
    post.document_extractions = await countOf("document_extractions", (q) => q.in("case_document_id", docIds));
    post.document_translations = await countOf("document_translations", (q) => q.in("case_document_id", docIds));
  }
  console.log("POST:", post);
  const nonZero = Object.entries(post).filter(([, v]) => v !== 0);
  if (nonZero.length) die("post-check", `quedaron filas: ${JSON.stringify(nonZero)}`);
  ok("post-check", "todas las tablas del reset en 0 — caso listo para el re-test E2E");
}

main().catch((e) => die("unexpected", e?.message ?? String(e)));
