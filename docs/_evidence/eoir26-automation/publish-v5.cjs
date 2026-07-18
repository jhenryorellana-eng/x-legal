/* EOIR-26 v5 — clona la versión publicada (v4) y aplica el mapeo/defaults de la
 * ola "cliente real Apelación" (issues #3-#7 de Henry, 2026-07-18):
 *
 *  - Ítem 2 (parte apelante)  ← document_extraction desicion-juez.appellants_line
 *  - Ítem 3 (¿detenido?)      ← desicion-juez.custody_status + value_map + DEFAULT "Not Detained"
 *  - Ítem 5 (tipo de decisión)← desicion-juez.decision_outcome (value_map) / decision_date
 *    · sub-preguntas Sí/No del grupo → default opción negativa ("NO" si no consta)
 *  - Checklist final "Lista final antes de enviar" (staff): default_value=true en TODO
 *    EXCEPTO: EOIR-27 · comprobante de pago / EOIR-26A · Prueba de Notificación (Ítem 12)
 *
 * SEGURIDAD:
 *  - Dry-run por defecto: imprime el estado actual + el plan de parches SIN escribir.
 *  - `--apply` requiere autorización explícita de Henry (escribe en PROD).
 *  - Aborta si existen respuestas vivas ancladas a la versión publicada de OTROS
 *    casos distintos al caso de prueba (evita FORM_VERSION_MISMATCH masivo).
 *  - Cada regla que no matchea ninguna pregunta ABORTA (no publica una v5 a medias).
 *
 * Uso:
 *   node docs/_evidence/eoir26-automation/publish-v5.cjs            # dry-run
 *   node docs/_evidence/eoir26-automation/publish-v5.cjs --apply    # ejecuta
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const ROOT = path.join(__dirname, "../../..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null;
};
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL || !SERVICE) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(2); }
const db = createClient(URL, SERVICE, { auth: { persistSession: false } });

const APPLY = process.argv.includes("--apply");
const TEST_CASE_ID = "e2528124-7255-4156-a378-ab5cffbbcf77"; // U26-000038 (clienta de prueba)
// Slug REAL del requirement en PROD (verificado contra la v4 el 2026-07-18):
const DECISION_SLUG = "decision-y-orden-del-juez-de-inmigracion";

const die = (step, msg) => { console.error(`FAIL [${step}]: ${msg}`); process.exit(1); };
const ok = (step, extra = "") => console.log(`OK   [${step}] ${extra}`);
const info = (msg) => console.log(`     ${msg}`);

const esLabel = (q) => ((q.question_i18n || {}).es || (q.question_i18n || {}).en || "").trim();
const optLabelEs = (o) => ((o.label_i18n || {}).es || (o.label_i18n || {}).en || o.value || "").trim();

async function main() {
  // ── 1. Cargar definición + versión publicada ───────────────────────────────
  const { data: def, error: e1 } = await db.from("form_definitions").select("id, slug, label_i18n").eq("slug", "eoir-26").maybeSingle();
  if (e1 || !def) die("load-def", e1?.message ?? "form_definitions.eoir-26 no existe");
  const { data: pub, error: e2 } = await db.from("form_automation_versions").select("*").eq("form_definition_id", def.id).eq("status", "published").maybeSingle();
  if (e2 || !pub) die("load-version", e2?.message ?? "no hay versión published de eoir-26");
  ok("load", `eoir-26 v${pub.version} published (${pub.id})`);

  const { data: groups, error: e3 } = await db.from("form_question_groups").select("*").eq("automation_version_id", pub.id).order("position");
  if (e3) die("load-groups", e3.message);
  const questionsByGroup = new Map();
  let allQuestions = [];
  for (const g of groups) {
    const { data: qs, error } = await db.from("form_questions").select("*").eq("group_id", g.id).order("position");
    if (error) die("load-questions", error.message);
    questionsByGroup.set(g.id, qs);
    allQuestions = allQuestions.concat(qs.map((q) => ({ ...q, _group: g })));
  }
  ok("load-questions", `${groups.length} grupos, ${allQuestions.length} preguntas`);

  // ── 2. Guard: respuestas vivas de OTROS casos ancladas a la versión actual ──
  const { data: liveResponses, error: e4 } = await db
    .from("case_form_responses").select("id, case_id, status")
    .eq("form_definition_id", def.id).eq("automation_version_id", pub.id);
  if (e4) die("guard-responses", e4.message);
  const foreign = (liveResponses ?? []).filter((r) => r.case_id !== TEST_CASE_ID);
  if (foreign.length > 0) {
    die("guard-responses", `hay ${foreign.length} respuestas vivas de OTROS casos ancladas a v${pub.version} — publicar v5 las rompería (FORM_VERSION_MISMATCH). Resuélvelas primero.`);
  }
  ok("guard-responses", `${(liveResponses ?? []).length} respuestas del caso de prueba (se resetean aparte), 0 ajenas`);

  // ── 3. Plan de parches (matchers data-driven sobre la v4 real) ─────────────
  /** patches: Map<questionId, { patch: Partial<row>, why: string }> */
  const patches = new Map();
  const addPatch = (q, patch, why) => {
    const prev = patches.get(q.id) ?? { patch: {}, why: [] };
    prev.patch = { ...prev.patch, ...patch };
    prev.why.push(why);
    patches.set(q.id, prev);
  };
  // Parches EXACTOS por pdf_field_name (verificados contra la v4 real en PROD
  // el 2026-07-18 — ver la consulta en el historial de la ola). Cada uno aborta
  // si el campo no existe, para nunca publicar una v5 a medias.
  const byPdfField = (name) => {
    const q = allQuestions.find((x) => x.pdf_field_name === name);
    if (!q) die(`field-${name}`, `no existe la pregunta con pdf_field_name "${name}" en la versión publicada`);
    return q;
  };

  // 3a. Ítem 3 ("3") — ¿detenido? La v4 YA extrae custody_status con value_map
  // {detained→Detained, non-detained→Not Detained}, pero SIN default y sin las
  // variantes reales que Gemini devuelve ("not detained" con espacio, etc.) —
  // por eso el cliente lo vio vacío. Se expande el mapa y default = Not Detained.
  {
    const q = byPdfField("3");
    addPatch(q, {
      source: "document_extraction",
      source_ref: {
        ...(q.source_ref ?? {}),
        document_slug: DECISION_SLUG,
        json_path: "custody_status",
        value_map: {
          "detained": "Detained",
          "in detention": "Detained",
          "in custody": "Detained",
          "detenido": "Detained",
          "non-detained": "Not Detained",
          "not detained": "Not Detained",
          "not in custody": "Not Detained",
          "no detenido": "Not Detained",
          "released": "Not Detained",
        },
        default_value: "Not Detained",
      },
    }, "ítem 3: value_map expandido (variantes reales de Gemini) + default 'Not Detained'");
  }

  // 3b. Ítem 5 ("5") — tipo de decisión apelada. Hoy es client_answer con
  // default "Merits proceedings appeal"; pasa a extraerse de la decisión:
  // is_bond_decision=true → Bond appeal; false → Merits; sin dato → default
  // Merits (la ruta más común). Las 4 fechas condicionales YA extraen
  // decision_date — sin cambios ahí.
  {
    const q = byPdfField("5");
    addPatch(q, {
      source: "document_extraction",
      source_ref: {
        ...(q.source_ref ?? {}),
        document_slug: DECISION_SLUG,
        json_path: "is_bond_decision",
        value_map: {
          "true": "Bond proceedings appeal",
          "false": "Merits proceedings appeal",
        },
        default_value: "Merits proceedings appeal",
      },
    }, "ítem 5: is_bond_decision → tipo de apelación + default Merits");
  }

  // 3c. Ítem 7 ("7") — solicitud de argumento oral. Único select Sí/No sin
  // default en la v4; "si no se encuentra, por defecto NO" (lo más común,
  // la propia opción lo dice). Sigue siendo editable por el cliente/staff.
  {
    const q = byPdfField("7");
    const no = (q.options ?? []).find((o) => /^no$/i.test(String(o.value)));
    if (!no) die("item7", "la pregunta '7' no tiene opción 'No'");
    addPatch(q, {
      source_ref: { ...(q.source_ref ?? {}), default_value: no.value },
    }, "ítem 7 (argumento oral): default 'No'");
  }

  // Verificación (sin parche) de lo que la v4 ya tiene bien y Henry pidió:
  // ítem 1 ← appellants_line, ítem 2 default Respondent/Applicant, fechas 5.x ←
  // decision_date, ítem 8 default Yes.
  for (const [field, expect] of [
    ["1. List names and alien numbers", "appellants_line"],
    ["Date 5.1_af_date", "decision_date"],
  ]) {
    const q = byPdfField(field);
    const jp = (q.source_ref ?? {}).json_path;
    if (jp !== expect) die(`verify-${field}`, `esperaba json_path=${expect}, la v4 tiene ${jp}`);
    info(`verify OK: "${field}" ← ${expect} (sin cambios)`);
  }

  // 3d. Checklist final — default_value=true salvo las 3 excepciones
  const checklistGroup = groups.find((g) => /lista final|antes de enviar|before (you )?send|checklist/i.test(((g.title_i18n || {}).es || "") + " " + ((g.title_i18n || {}).en || "")));
  if (!checklistGroup) die("checklist", "no encuentro el grupo 'Lista final antes de enviar' — revisa la v4");
  const EXCEPTIONS = /eoir-?27|eoir-?26a|tarifa|fee|comprobante|pago|payment|prueba de notificaci[oó]n|proof of service|[ií]tem\s*12/i;
  let checklistPatched = 0;
  let checklistExceptions = 0;
  for (const q of questionsByGroup.get(checklistGroup.id)) {
    if (q.field_type !== "checkbox") continue;
    if (EXCEPTIONS.test(esLabel(q))) {
      info(`checklist: SIN default (excepción): ${esLabel(q).slice(0, 90)}`);
      checklistExceptions++;
      continue;
    }
    addPatch(q, { source_ref: { ...(q.source_ref ?? {}), default_value: true } }, "checklist: marcado por defecto");
    checklistPatched++;
  }
  if (checklistPatched === 0) die("checklist", "0 checkboxes marcables en el checklist — revisa la v4");
  // Guard simétrico (review 2026-07-18): si el regex de EXCEPCIONES no matchea
  // al menos 2 casillas (pago/EOIR-26A + Prueba de Notificación Ítem 12), el
  // texto real de la v4 difiere del esperado y marcaríamos por defecto casillas
  // que Henry pidió dejar SIN marcar — abortar en vez de publicar eso.
  if (checklistExceptions < 2) {
    die("checklist", `solo ${checklistExceptions} excepciones matcheadas (esperaba ≥2: pago/EOIR-26A e Ítem 12) — ajusta EXCEPTIONS al texto real de la v4`);
  }

  // ── 4. Reporte del plan ────────────────────────────────────────────────────
  console.log("\n=== PLAN DE PARCHES (v" + pub.version + " → v" + (pub.version + 1) + ") ===");
  for (const [qid, p] of patches) {
    const q = allQuestions.find((x) => x.id === qid);
    console.log(` • [${q?.pdf_field_name ?? qid.slice(0, 8)}] ${esLabel(q).slice(0, 80)}`);
    for (const w of p.why) console.log(`     → ${w}`);
  }
  console.log(`Total: ${patches.size} preguntas parchadas de ${allQuestions.length}.`);

  if (!APPLY) {
    console.log("\nDRY-RUN — nada escrito. Ejecuta con --apply (requiere OK de Henry) para publicar v5.");
    return;
  }

  // ── 5. Clonar v4 → v5 (draft), aplicar parches, publicar ──────────────────
  const strip = ({ id: _i, created_at: _c, updated_at: _u, ...rest }) => rest;
  const { data: v5, error: e5 } = await db.from("form_automation_versions").insert({
    ...strip(pub), version: pub.version + 1, status: "draft", published_at: null,
  }).select().single();
  if (e5) die("clone-version", e5.message);
  ok("clone-version", `v${v5.version} draft (${v5.id})`);

  for (const g of groups) {
    const { data: ng, error: eg } = await db.from("form_question_groups").insert({
      ...strip(g), automation_version_id: v5.id,
    }).select().single();
    if (eg) die("clone-group", eg.message);
    for (const q of questionsByGroup.get(g.id)) {
      const patch = patches.get(q.id)?.patch ?? {};
      const { error: eq } = await db.from("form_questions").insert({
        ...strip({ ...q, _group: undefined }), ...patch, group_id: ng.id,
      });
      if (eq) die("clone-question", `${esLabel(q).slice(0, 60)}: ${eq.message}`);
    }
  }
  ok("clone-questions", "grupos y preguntas clonados con parches");

  // Publicar: archivar v4, publicar v5 (índice parcial: 1 published por definición).
  const { error: e6 } = await db.from("form_automation_versions").update({ status: "archived" }).eq("id", pub.id);
  if (e6) die("archive-v4", e6.message);
  const { error: e7 } = await db.from("form_automation_versions").update({ status: "published", published_at: new Date().toISOString() }).eq("id", v5.id);
  if (e7) die("publish-v5", e7.message);
  ok("publish", `eoir-26 v${v5.version} PUBLICADA (v${pub.version} archivada)`);
  console.log("\nListo. Verifica con el fill de humo del re-test E2E.");
}

main().catch((e) => die("unexpected", e?.message ?? String(e)));
