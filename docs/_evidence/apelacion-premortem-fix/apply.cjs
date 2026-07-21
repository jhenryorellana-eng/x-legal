/* Pre-Mortem fiel + generación sin re-caracterización (apelación BIA) — 2026-07-21.
 *
 * Config-as-data IDEMPOTENTE (no toca casos ni datos de clientes):
 *   1. form_fill_guides: re-lee las dos guías LIMPIAS de disco (Statement + Proof) —
 *      el caso de ejemplo Ticllacuri fue reemplazado por placeholders genéricos y se
 *      quitó la "Nota para el validador" (el Pre-Mortem ya ve los tokens resueltos).
 *   2. escrito-de-apelacion (brief): append de la regla anti-recaracterización al
 *      rules_text custom (R13) si aún no está — misma prohibición que la R2 del código
 *      DEFAULT_GENERATION_RULES (Statement/Proof la heredan del código, sin custom).
 *
 * Los cambios de PROMPT del validador y de DEFAULT_GENERATION_RULES viven en el CÓDIGO
 * (deploy), no aquí. Este seed solo actualiza datos.
 *
 * Uso:  node docs/_evidence/apelacion-premortem-fix/apply.cjs
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

const PHASE_ID = "f62fafe4-f5ef-49ac-9565-919d8c2a3ce1"; // apelacion / fase-1

const die = (step, error) => { console.error(`FAIL [${step}]:`, error?.message ?? error); process.exit(1); };
const ok = (step, extra = "") => console.log(`OK   [${step}] ${extra}`);
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// Anti-reclassification rule appended to the brief's custom rules_text (mirror of the
// clause added to DEFAULT_GENERATION_RULES R2 in ai-engine/domain.ts).
const R13 =
  "R13. NEVER reclassify a documented event as a legal status or figure the record does not literally state " +
  '(e.g. an entry without inspection / "EWI" is not a "deportation" or "removal"; an I-94 admission class such as ' +
  '"DT"/deferred inspection is not "humanitarian parole" unless the record says so). Use the record\'s exact terms; ' +
  "when a legal status is not explicit in the record, describe the event neutrally or use a placeholder rather than inferring it.";
const R13_MARKER = "reclassify a documented event";

async function fdIdBySlug(slug) {
  const { data, error } = await db.from("form_definitions").select("id").eq("service_phase_id", PHASE_ID).eq("slug", slug).maybeSingle();
  if (error) die(`fd lookup ${slug}`, error);
  if (!data) die(`fd lookup ${slug}`, "not found");
  return data.id;
}

async function upsertGuide(slug, guidePath) {
  const letterId = await fdIdBySlug(slug);
  const row = { form_definition_id: letterId, guide_markdown: read(guidePath), source_file_path: guidePath, enabled: true };
  const { data: existing } = await db.from("form_fill_guides").select("form_definition_id").eq("form_definition_id", letterId).maybeSingle();
  const r = existing
    ? await db.from("form_fill_guides").update(row).eq("form_definition_id", letterId)
    : await db.from("form_fill_guides").insert(row);
  if (r.error) die(`guide ${slug}`, r.error);
  ok(`guide ${slug}`, `(${row.guide_markdown.length} chars)`);
}

async function appendBriefRule(slug) {
  const letterId = await fdIdBySlug(slug).catch(() => null);
  if (!letterId) { ok(`brief rule ${slug}`, "form not found — skipped"); return; }
  const { data, error } = await db.from("ai_generation_configs").select("rules_text, rules_enabled").eq("form_definition_id", letterId).maybeSingle();
  if (error) die(`brief rule ${slug} read`, error);
  if (!data) { ok(`brief rule ${slug}`, "no config — skipped"); return; }
  const current = (data.rules_text ?? "").trim();
  if (!current) { ok(`brief rule ${slug}`, "no custom rules_text (uses code default) — skipped"); return; }
  if (current.includes(R13_MARKER)) { ok(`brief rule ${slug}`, "already present — idempotent skip"); return; }
  const next = current + "\n" + R13;
  const r = await db.from("ai_generation_configs").update({ rules_text: next }).eq("form_definition_id", letterId);
  if (r.error) die(`brief rule ${slug}`, r.error);
  ok(`brief rule ${slug}`, "appended R13");
}

(async () => {
  await upsertGuide("statement-of-reasons-for-appeal", "docs/guides/statement-of-reasons-for-appeal-guia.md");
  await upsertGuide("proof-of-service", "docs/guides/proof-of-service-guia.md");
  await appendBriefRule("escrito-de-apelacion");
  console.log("DONE");
})();
