/* Fase 2.2 — Generate the reforzar Credible-Fear questionnaire with the REAL pipeline.
 * Writes prod-verify/reforzar-questionnaire.json. Run: npx -y tsx docs/_evidence/prod-verify/90-gen-questionnaire-reforzar.ts */
import * as fs from "fs";
import * as path from "path";
import { loadEnv, IDS } from "./_env";
loadEnv();

const ids = JSON.parse(fs.readFileSync(path.resolve(__dirname, "reforzar-ids.json"), "utf8"));
const CASE_ID = ids.caseId;
const Q_FORM = IDS.MEMO_REFORZAR_QUESTIONNAIRE_FORM;
const ts = () => new Date().toISOString().slice(11, 19);

(async () => {
  const repo = await import("../../../src/backend/modules/ai-engine/repository");
  const svc = await import("../../../src/backend/modules/ai-engine/service");

  const config = await repo.findQuestionnaireGenerationConfig(Q_FORM);
  if (!config) throw new Error("no questionnaire config");
  console.log(`[${ts()}] config mode=${config.mode} model=${config.model} docs=${config.input_document_slugs}`);

  const resolved = await repo.resolveGenerationInputs(CASE_ID, null, config.input_form_slugs, config.input_document_slugs);
  console.log(`[${ts()}] resolved inputs: ${resolved.documents.length} docs, ${resolved.forms.length} forms`);

  const version = await repo.nextQuestionnaireInstanceVersion(CASE_ID, Q_FORM, null);
  const inst = await repo.createQuestionnaireInstance({
    case_id: CASE_ID, form_definition_id: Q_FORM, party_id: null,
    status: "queued", version, mode: config.mode, inputs_snapshot: resolved as never, model: config.model,
  });
  console.log(`[${ts()}] instance ${inst.id} v${version} queued — running generator…`);

  const outcome = await svc.executeQuestionnaireGenerationJob({ caseId: CASE_ID, formDefinitionId: Q_FORM, partyId: null });
  const final = await repo.findQuestionnaireInstanceById(inst.id);
  console.log(`[${ts()}] outcome=${outcome} status=${final?.status} tokens(in=${final?.input_tokens}, out=${final?.output_tokens}) cost=$${final?.cost_usd}`);

  const schema = (final?.schema ?? { groups: [] }) as { groups: Array<{ title_i18n?: { es?: string }; questions: Array<{ id?: string; question_i18n?: { es?: string }; field_type?: string }> }> };
  let n = 0;
  for (const g of schema.groups) { console.log(`\n### ${g.title_i18n?.es ?? ""}`); for (const q of g.questions) { n++; console.log(`  ${n}. [${q.field_type}] ${(q.question_i18n?.es ?? "").slice(0, 90)}`); } }
  console.log(`\n[${ts()}] TOTAL ${n} preguntas. instance=${inst.id}`);
  fs.writeFileSync(path.resolve(__dirname, "reforzar-questionnaire.json"), JSON.stringify({ instanceId: inst.id, status: final?.status, schema }, null, 2));
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
