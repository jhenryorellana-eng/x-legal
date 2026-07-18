/* Fix v5 conditions: el clon v4→v5 acuñó ids nuevos por pregunta pero las
 * `condition.when.question` clonadas siguen apuntando a los ids de la v4 →
 * los condicionales (fechas del ítem 5) nunca se muestran ni se llenan.
 * Remapea v4id→v5id emparejando por (posición de grupo, posición de pregunta).
 * Dry-run por defecto; --apply escribe.
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));
const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null; };
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const APPLY = process.argv.includes("--apply");
const die = (s, m) => { console.error(`FAIL [${s}]: ${m}`); process.exit(1); };

async function loadVersion(status) {
  const { data: def } = await db.from("form_definitions").select("id").eq("slug", "eoir-26").maybeSingle();
  const { data: ver } = await db.from("form_automation_versions").select("id, version").eq("form_definition_id", def.id).eq("status", status).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!ver) die("load", `sin versión ${status}`);
  const { data: groups } = await db.from("form_question_groups").select("id, position").eq("automation_version_id", ver.id).order("position");
  const questions = [];
  for (const g of groups) {
    const { data: qs } = await db.from("form_questions").select("id, position, condition, question_i18n").eq("group_id", g.id).order("position");
    for (const q of qs) questions.push({ ...q, gpos: g.position });
  }
  return { ver, questions };
}

(async () => {
  const v4 = await loadVersion("archived");
  const v5 = await loadVersion("published");
  console.log(`v4=${v4.ver.version} (${v4.questions.length} q) → v5=${v5.ver.version} (${v5.questions.length} q)`);
  if (v4.questions.length !== v5.questions.length) die("match", "conteo de preguntas difiere entre v4 y v5");

  const key = (q) => `${q.gpos}:${q.position}`;
  const v5ByKey = new Map(v5.questions.map((q) => [key(q), q]));
  const idMap = new Map(); // v4 id → v5 id
  for (const q4 of v4.questions) {
    const q5 = v5ByKey.get(key(q4));
    if (!q5) die("match", `sin par para ${key(q4)}`);
    idMap.set(q4.id, q5.id);
  }

  let fixed = 0;
  for (const q5 of v5.questions) {
    const c = q5.condition;
    if (!c || typeof c !== "object" || !c.when || !c.when.question) continue;
    const ref = c.when.question;
    const mapped = idMap.get(ref);
    if (!mapped) {
      // ya apunta a un id v5 (o a algo desconocido)
      const isV5 = v5.questions.some((x) => x.id === ref);
      console.log(`${isV5 ? "ok " : "??? "} cond de "${(q5.question_i18n?.es || "").slice(0, 50)}" → ${ref.slice(0, 8)}${isV5 ? " (v5)" : " (DESCONOCIDO)"}`);
      continue;
    }
    console.log(`FIX cond de "${(q5.question_i18n?.es || "").slice(0, 50)}": ${ref.slice(0, 8)}(v4) → ${mapped.slice(0, 8)}(v5)`);
    fixed++;
    if (APPLY) {
      const newCond = { ...c, when: { ...c.when, question: mapped } };
      const { error } = await db.from("form_questions").update({ condition: newCond }).eq("id", q5.id);
      if (error) die("update", error.message);
    }
  }
  console.log(`${APPLY ? "APLICADO" : "DRY-RUN"}: ${fixed} condiciones remapeadas.`);
})();
