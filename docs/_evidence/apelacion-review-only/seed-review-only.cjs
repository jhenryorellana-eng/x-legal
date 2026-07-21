/* Apelación — cuestionarios de las dos cartas en modo "solo revisar".
 *
 * Aplica de forma IDEMPOTENTE un único delta de config sobre los dos cuestionarios
 * companion (Statement of Reasons + Proof of Service):
 *
 *   questionnaire_generation_configs.target_question_count = 0
 *
 * `target_question_count = 0` (soportado por el motor tras este cambio de código)
 * significa "solo revisar": el job NO genera preguntas nuevas (que el cliente solo
 * podría contestar de memoria → "No recuerdo") pero SÍ redacta los borradores de las
 * preguntas base desde los documentos subidos. Las preguntas base ya son opcionales
 * / con default determinista (método = correo de 1ª clase, dirección OCC por mapa),
 * y el guardrail anti-corchetes vive en el system prompt de los borradores.
 *
 * NO toca casos ni datos de clientes; solo la config de catálogo de la fase de
 * apelación. Tras aplicarlo, regenerar las instancias del caso a verificar
 * (auto-trigger al reabrir el cuestionario, o trigger-bootstrap).
 *
 * Uso:  node docs/_evidence/apelacion-review-only/seed-review-only.cjs
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
const SLUGS = [
  "statement-of-reasons-for-appeal-cuestionario",
  "proof-of-service-cuestionario",
];

const die = (step, error) => { console.error(`FAIL [${step}]:`, error?.message ?? error); process.exit(1); };
const ok = (step, extra = "") => console.log(`OK   [${step}] ${extra}`);

async function main() {
  for (const slug of SLUGS) {
    const { data: fd, error: e1 } = await db
      .from("form_definitions").select("id")
      .eq("service_phase_id", PHASE_ID).eq("slug", slug).maybeSingle();
    if (e1) die(`fd lookup ${slug}`, e1);
    if (!fd) die(`fd lookup ${slug}`, "not found");

    const { error: e2, count } = await db
      .from("questionnaire_generation_configs")
      .update({ target_question_count: 0 }, { count: "exact" })
      .eq("form_definition_id", fd.id);
    if (e2) die(`update ${slug}`, e2);
    ok(slug, `target_question_count=0 (rows=${count ?? "?"})`);
  }
  console.log("\nDONE — ambos cuestionarios en modo 'solo revisar'.");
}

main().catch((e) => die("main", e));
