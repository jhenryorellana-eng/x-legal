/* Ola 4 — "documentos sin espacios en blanco" (apelación BIA). Aplica de forma
 * IDEMPOTENTE los deltas de config sobre los dos ai_letters ya existentes:
 *   1. Statement of Reasons: system_prompt + sections (emiten tokens de dirección),
 *      input_form_slugs += 'eoir-26', letter_fill.appellant_contact.
 *   2. Proof of Service: system_prompt + sections (emiten {{OCC_ADDRESS}} +
 *      {{SERVICE_METHOD_CHECKBOXES}}), letter_fill.occ_address + service_method.
 *   3. Proof questionnaire: método de envío → select (default correo 1ª clase);
 *      dirección OCC → override opcional (texto que casa con letter_fill).
 *   4. form_fill_guides re-leídas (las guías ya declaran los tokens nuevos).
 *
 * NO toca casos ni datos de clientes. Requiere migración 0103 (letter_fill) aplicada.
 * Uso:  node docs/_evidence/apelacion-ola4/seed.cjs
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));
const CONTENT = require("./content.cjs");

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

async function fdIdBySlug(slug) {
  const { data, error } = await db.from("form_definitions").select("id").eq("service_phase_id", PHASE_ID).eq("slug", slug).maybeSingle();
  if (error) die(`fd lookup ${slug}`, error);
  if (!data) die(`fd lookup ${slug}`, "not found");
  return data.id;
}

async function updateGenConfig(letterId, patch, step) {
  const r = await db.from("ai_generation_configs").update(patch).eq("form_definition_id", letterId);
  if (r.error) die(step, r.error);
  ok(step);
}

async function upsertGuide(letterId, guidePath, step) {
  const row = { form_definition_id: letterId, guide_markdown: read(guidePath), source_file_path: guidePath, enabled: true };
  const { data: existing } = await db.from("form_fill_guides").select("form_definition_id").eq("form_definition_id", letterId).maybeSingle();
  const r = existing
    ? await db.from("form_fill_guides").update(row).eq("form_definition_id", letterId)
    : await db.from("form_fill_guides").insert(row);
  if (r.error) die(step, r.error);
  ok(step);
}

/** Proof questionnaire base questions, ordered by position (0 = método, 1 = dirección). */
async function proofBaseQuestions() {
  const qnId = await fdIdBySlug(CONTENT.PROOF.qn_slug);
  const { data: ver } = await db.from("form_automation_versions").select("id").eq("form_definition_id", qnId).eq("status", "published").maybeSingle();
  if (!ver) die("proof qn version", "no published version");
  const { data: groups } = await db.from("form_question_groups").select("id").eq("automation_version_id", ver.id);
  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: qs, error } = await db.from("form_questions").select("id, position").in("group_id", groupIds).order("position");
  if (error) die("proof qn questions", error);
  return qs ?? [];
}

(async () => {
  const statementId = await fdIdBySlug(CONTENT.STATEMENT.letter_slug);
  const proofId = await fdIdBySlug(CONTENT.PROOF.letter_slug);

  // 1. Statement ai_generation_config
  await updateGenConfig(statementId, {
    system_prompt: CONTENT.STATEMENT.system_prompt,
    sections: CONTENT.STATEMENT.sections,
    input_form_slugs: CONTENT.STATEMENT.input_form_slugs,
    letter_fill: CONTENT.STATEMENT.letter_fill,
  }, "statement gen config");

  // 2. Proof ai_generation_config
  await updateGenConfig(proofId, {
    system_prompt: CONTENT.PROOF.system_prompt,
    sections: CONTENT.PROOF.sections,
    letter_fill: CONTENT.PROOF.letter_fill,
  }, "proof gen config");

  // 3. Proof questionnaire: método → select; dirección → override help + matching text
  const qs = await proofBaseQuestions();
  const metodo = qs[0];
  const direccion = qs[1];
  if (!metodo || !direccion) die("proof qn base questions", `expected 2, got ${qs.length}`);

  {
    const r = await db.from("form_questions").update({
      question_i18n: CONTENT.PROOF.method_question.question_i18n,
      help_i18n: CONTENT.PROOF.method_question.help_i18n,
      field_type: CONTENT.PROOF.method_question.field_type,
      options: CONTENT.PROOF.method_question.options,
      source: CONTENT.PROOF.method_question.source,
      source_ref: CONTENT.PROOF.method_question.source_ref,
      is_required: CONTENT.PROOF.method_question.is_required,
      empty_policy: CONTENT.PROOF.method_question.empty_policy,
    }).eq("id", metodo.id);
    if (r.error) die("proof método select", r.error);
    ok("proof método select", `q=${metodo.id}`);
  }
  {
    const r = await db.from("form_questions").update({
      question_i18n: { es: CONTENT.PROOF.address_override_question_es, en: "What is the address of the Office of the Chief Counsel (DHS/OPLA)?" },
      help_i18n: CONTENT.PROOF.address_override_help,
      is_required: false,
      empty_policy: "blank",
    }).eq("id", direccion.id);
    if (r.error) die("proof dirección override", r.error);
    ok("proof dirección override", `q=${direccion.id}`);
  }

  // 4. form_fill_guides (guías ya declaran los tokens nuevos)
  await upsertGuide(statementId, CONTENT.STATEMENT.guide_path, "statement guide");
  await upsertGuide(proofId, CONTENT.PROOF.guide_path, "proof guide");

  console.log("\nDONE — Ola 4 (documentos sin espacios en blanco) sembrada.");
})().catch((e) => die("unhandled", e));
