/* Ola 3 — genera el cuestionario dinámico de Karelis con el PIPELINE REAL de producción
 * (resolveGenerationInputs → createQuestionnaireInstance → executeQuestionnaireGenerationJob)
 * y muestra las preguntas súper-detalladas que la IA crea leyendo su I-589 + declaración
 * jurada + evidencias. Bypassa el actor usando el repositorio directo (script fuera del lint).
 *
 * Run:  npx -y tsx docs/_evidence/f-karelis/gen-questionnaire.ts
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(__dirname, "../../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const CASE_ID = "559220ae-796b-4110-ab45-bfc7eea6a564";
const Q_FORM = "138f4f0e-88fb-4694-baa0-2981964d8bfc"; // memorandum-de-miedo-creible-cuestionario

async function main() {
  const repo = await import("../../../src/backend/modules/ai-engine/repository");
  const svc = await import("../../../src/backend/modules/ai-engine/service");

  const config = await repo.findQuestionnaireGenerationConfig(Q_FORM);
  if (!config) throw new Error("no config — did migration 0082 apply?");
  console.log(`config: mode=${config.mode} inputs(forms=${config.input_form_slugs}, docs=${config.input_document_slugs}) model=${config.model}`);

  const resolved = await repo.resolveGenerationInputs(CASE_ID, null, config.input_form_slugs, config.input_document_slugs);
  console.log(`resolved inputs: ${resolved.documents.length} documents, ${resolved.forms.length} forms`);

  const version = await repo.nextQuestionnaireInstanceVersion(CASE_ID, Q_FORM, null);
  const inst = await repo.createQuestionnaireInstance({
    case_id: CASE_ID, form_definition_id: Q_FORM, party_id: null,
    status: "queued", version, mode: config.mode,
    inputs_snapshot: resolved as never, model: config.model,
  });
  console.log(`instance ${inst.id} v${version} queued — running generator…`);

  const outcome = await svc.executeQuestionnaireGenerationJob({ caseId: CASE_ID, formDefinitionId: Q_FORM, partyId: null });
  const final = await repo.findQuestionnaireInstanceById(inst.id);
  console.log(`\noutcome=${outcome} status=${final?.status} tokens(in=${final?.input_tokens}, out=${final?.output_tokens}) cost=$${final?.cost_usd}`);

  const schema = (final?.schema ?? { groups: [] }) as { groups: Array<{ title_i18n: { es: string }; questions: Array<{ question_i18n: { es: string }; field_type: string; help_i18n?: { es?: string } | null }> }> };
  let n = 0;
  for (const g of schema.groups) {
    console.log(`\n### ${g.title_i18n.es}`);
    for (const q of g.questions) {
      n++;
      console.log(`  ${n}. [${q.field_type}] ${q.question_i18n.es}`);
      if (q.help_i18n?.es) console.log(`      ↳ ${q.help_i18n.es}`);
    }
  }
  console.log(`\nTOTAL: ${n} preguntas generadas.`);
}

main().catch((e) => { console.error("GEN FAILED:", e); process.exit(1); });
