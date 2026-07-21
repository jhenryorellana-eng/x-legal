/* Ola 3 del servicio de Apelación (BIA) — reestructuración del paquete a:
 *   EOIR-26 + Statement of Reasons for Appeal + Proof of Service (+ recibo opcional).
 *
 * Autorizado por Henry (2026-07-20). Idempotente: cada paso comprueba existencia por
 * slug / question_id antes de insertar; re-ejecutar solo actualiza payloads (upsert).
 * NO toca casos ni datos de clientes.
 *
 * Hace, en el servicio `apelacion` (fase-1):
 *  1. Crea 2 ai_letters nuevos (Statement of Reasons / Proof of Service), cada uno con:
 *     form_definition + companion questionnaire + versión published + preguntas base +
 *     ai_generation_configs + questionnaire_generation_configs (draft_answers_enabled) +
 *     form_fill_guides (rúbrica del Pre-Mortem, desde docs/guides/*.md).
 *  2. Crea el documento opcional `copia-recibo-de-pago` (ocultable por Vanessa).
 *  3. Desactiva (is_active=false, reversible): escrito-de-apelacion (+cuestionario),
 *     mocion-pretermision-dhs, evidencias-sustentatorias.
 *  4. Ajusta campos del EOIR-26: #6 fijo, #9 y #12(B) = fecha de hoy (current_date),
 *     #12(C) = OPLA, checklist Proof-of-Service + Receipt marcados por defecto.
 *  5. Reescribe services.expediente_guidance con el nuevo orden del paquete.
 *
 * Requisitos: migración 0101 (source current_date) aplicada ANTES de este seed.
 * Uso:  node docs/_evidence/apelacion-ola3/seed.cjs
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

const PHASE_ID = "f62fafe4-f5ef-49ac-9565-919d8c2a3ce1";     // apelacion / fase-1
const SERVICE_SLUG = "apelacion";
const ORG_ID = "a3e5f333-455a-4b3b-a5da-5a3716d24761";
const QN_TEMPLATE_VERSION_ID = "a45644eb-a7bd-4b28-9391-11f572da0678"; // shape para clonar
const DATASET_NAME = "Precedentes de apelación BIA";

// EOIR-26 (published) — ids verificados 2026-07-20
const EOIR = {
  item6_qid: "dd337f21-9fbe-41a6-80d7-fcd787a49866",
  item9_group_id: "b852c0c0-f79e-4527-854a-f09b55b8aa94",
  item12b_qid: "35536c5b-426b-4002-9873-3de96aafe58b",
  item12c_qid: "0d3ac5fa-cade-4b62-81b2-bc03eefb17f1",
  // Método de envío (#12): gatea #12B/#12C/#12D via condition == 'mailed_or_delivered'.
  // Se marca por defecto en correo/entrega para que la fecha (#12B), OPLA (#12C) y la
  // dirección (#12D) se muestren por defecto; la asesora puede cambiarlo a ECAS.
  item12_method_qid: "850d72f3-dd35-4419-85b8-24cfb247ac63",
  item12d_qid: "ac100a5a-66ac-4d2c-b62a-962bf824f661", // #12D dirección (client_answer)
  proof_checkbox_qid: "b6feb671-1d96-4398-a627-ddfeb5d006af",
  receipt_checkbox_qid: "fcc4209e-c183-4341-8504-02502057cf90",
};

const die = (step, error) => { console.error(`FAIL [${step}]:`, error?.message ?? error); process.exit(1); };
const ok = (step, extra = "") => console.log(`OK   [${step}] ${extra}`);
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const ASSEMBLY = {
  // Single self-contained court document: its own header/caption/title come from the
  // sections; no wrapper cover/toc/closing here (the expediente adds the carátula).
  toc: false, cover: false, annexes: false, chronology: false,
  blocks: [{ type: "body", enabled: true }],
};

async function upsertFd(row) {
  const { data: existing } = await db.from("form_definitions").select("id").eq("service_phase_id", PHASE_ID).eq("slug", row.slug).maybeSingle();
  if (existing) {
    const r = await db.from("form_definitions").update(row).eq("id", existing.id);
    if (r.error) die(`fd ${row.slug}`, r.error);
    return existing.id;
  }
  const r = await db.from("form_definitions").insert(row).select("id").single();
  if (r.error) die(`fd ${row.slug}`, r.error);
  return r.data.id;
}

async function ensureQuestionnaireVersion(qnId) {
  const { data: existingVer } = await db.from("form_automation_versions").select("id").eq("form_definition_id", qnId).eq("status", "published").maybeSingle();
  if (existingVer) return existingVer.id;
  const { data: tpl, error: tplErr } = await db.from("form_automation_versions").select("*").eq("id", QN_TEMPLATE_VERSION_ID).single();
  if (tplErr) die("qn version template", tplErr);
  const row = { ...tpl };
  delete row.id; delete row.created_at; delete row.updated_at;
  row.form_definition_id = qnId; row.version = 1; row.status = "published";
  row.source_pdf_path = null; row.detected_fields = [];
  const r = await db.from("form_automation_versions").insert(row).select("id").single();
  if (r.error) die("qn version insert", r.error);
  return r.data.id;
}

async function ensureBaseQuestions(verId, baseQuestions, groupTitle) {
  const { data: existingGroups } = await db.from("form_question_groups").select("id").eq("automation_version_id", verId);
  if ((existingGroups ?? []).length > 0) return; // ya sembrado
  const g = await db.from("form_question_groups").insert({
    automation_version_id: verId, position: 0, do_not_fill: false, title_i18n: groupTitle,
  }).select("id").single();
  if (g.error) die("qn group", g.error);
  const rows = baseQuestions.map(([key, es, en, required, helpEs, helpEn], i) => ({
    group_id: g.data.id, position: i,
    question_i18n: { es, en }, help_i18n: { es: helpEs, en: helpEn },
    field_type: "textarea", options: null, source: "client_answer", source_ref: null,
    is_required: required, validation: null, condition: null, pdf_field_name: null,
    empty_policy: "inherit", empty_placeholder: null, no_translate: false, ai_improve: null,
  }));
  const r = await db.from("form_questions").insert(rows);
  if (r.error) die("qn base questions", r.error);
}

async function upsertRow(table, keyCol, keyVal, row, step) {
  const { data: existing } = await db.from(table).select(keyCol).eq(keyCol, keyVal).maybeSingle();
  const r = existing
    ? await db.from(table).update(row).eq(keyCol, keyVal)
    : await db.from(table).insert(row);
  if (r.error) die(step, r.error);
}

async function seedAiLetter(cfg, datasetId) {
  // ai_letter + companion questionnaire
  const letterId = await upsertFd({
    service_phase_id: PHASE_ID, slug: cfg.slug, kind: "ai_letter",
    label_i18n: cfg.label_i18n, description_i18n: cfg.description_i18n,
    filled_by: "client", is_per_party: false, party_roles: null, position: 1,
    is_active: true, requires_documents_complete: true,
  });
  const qnId = await upsertFd({
    service_phase_id: PHASE_ID, slug: `${cfg.slug}-cuestionario`, kind: "questionnaire",
    label_i18n: cfg.qn_label_i18n, description_i18n: cfg.qn_description_i18n,
    filled_by: "client", is_per_party: false, party_roles: null, position: 2,
    is_active: true, requires_documents_complete: true,
  });
  { const r = await db.from("form_definitions").update({ companion_questionnaire_id: qnId }).eq("id", letterId);
    if (r.error) die(`companion ${cfg.slug}`, r.error); }

  const verId = await ensureQuestionnaireVersion(qnId);
  await ensureBaseQuestions(verId, cfg.base_questions, cfg.qn_label_i18n);

  // ai_generation_configs
  await upsertRow("ai_generation_configs", "form_definition_id", letterId, {
    form_definition_id: letterId, system_prompt: cfg.system_prompt,
    input_document_slugs: cfg.input_document_slugs,
    input_form_slugs: [`${cfg.slug}-cuestionario`, "eoir-26a"],
    dataset_id: cfg.use_dataset ? datasetId : null,
    model: "claude-sonnet-4-6", max_output_tokens: 8000,
    output_format: "pdf", output_language: "en",
    web_search_enabled: false, web_search_max_uses: 0,
    research_instructions: null, research_model: null,
    sections: cfg.sections, rules_enabled: true, rules_text: null, assembly: ASSEMBLY,
    attach_sources_enabled: false, attach_sources_kinds: [], curated_sources: [],
  }, `gen config ${cfg.slug}`);

  // questionnaire_generation_configs (auto-fill on)
  await upsertRow("questionnaire_generation_configs", "form_definition_id", qnId, {
    form_definition_id: qnId, mode: "hybrid", generation_prompt: cfg.qn_generation_prompt,
    input_document_slugs: cfg.input_document_slugs, input_form_slugs: [],
    prerequisite_form_slugs: [], prerequisite_document_slugs: ["decision-y-orden-del-juez-de-inmigracion"],
    target_question_count: cfg.base_questions.length + 3, model: "claude-sonnet-4-6",
    hybrid_layout: "append_group", auto_trigger: true, allow_client_trigger: false,
    on_new_evidence: "never", draft_answers_enabled: true, draft_answers_prompt: cfg.draft_answers_prompt,
  }, `qn gen config ${cfg.slug}`);

  // form_fill_guides (rúbrica Pre-Mortem)
  await upsertRow("form_fill_guides", "form_definition_id", letterId, {
    form_definition_id: letterId, guide_markdown: read(cfg.guide_path),
    source_file_path: cfg.guide_path, enabled: true,
  }, `guide ${cfg.slug}`);

  ok(`ai_letter ${cfg.slug}`, `letter=${letterId} qn=${qnId}`);
}

(async () => {
  // ── dataset (reutiliza el existente de apelación) ──────────────────────────
  let datasetId = null;
  {
    const { data } = await db.from("ai_datasets").select("id").eq("org_id", ORG_ID).eq("name", DATASET_NAME).maybeSingle();
    datasetId = data?.id ?? null;
    ok("dataset", datasetId ?? "(no encontrado — statement irá sin dataset)");
  }

  // ── 1. Los dos ai_letters ──────────────────────────────────────────────────
  await seedAiLetter(CONTENT.STATEMENT, datasetId);
  await seedAiLetter(CONTENT.PROOF, datasetId);

  // ── 2. Documento opcional copia-recibo-de-pago ─────────────────────────────
  {
    const { data: existing } = await db.from("required_document_types").select("id").eq("service_phase_id", PHASE_ID).eq("slug", "copia-recibo-de-pago").maybeSingle();
    const row = {
      service_phase_id: PHASE_ID, slug: "copia-recibo-de-pago",
      label_i18n: { es: "Copia del recibo de pago", en: "Copy of the fee payment receipt" },
      help_i18n: {
        es: "Sube el recibo del pago de la tarifa de apelación ($1,030) del EOIR Payment Portal (PDF). Si en cambio usas la exención (EOIR-26A), tu asesora puede ocultar este documento.",
        en: "Upload the appeal fee ($1,030) payment receipt from the EOIR Payment Portal (PDF). If you use the Fee Waiver (EOIR-26A) instead, your advisor can hide this document.",
      },
      category_i18n: { es: "Pago", en: "Payment" },
      is_required: false, is_per_party: false, party_roles: null,
      ai_extract: false, extraction_schema: null,
      requires_translation: false, requires_certified_copy: false,
      position: 5, is_active: true, accepted_format: "pdf", allow_multiple: false,
    };
    const r = existing
      ? await db.from("required_document_types").update(row).eq("id", existing.id)
      : await db.from("required_document_types").insert(row);
    if (r.error) die("copia-recibo-de-pago", r.error);
    ok("copia-recibo-de-pago", existing ? "(update)" : "(insert)");
  }

  // ── 3. Desactivar lo que ya no se usa ──────────────────────────────────────
  for (const slug of ["escrito-de-apelacion", "escrito-de-apelacion-cuestionario"]) {
    const r = await db.from("form_definitions").update({ is_active: false }).eq("service_phase_id", PHASE_ID).eq("slug", slug);
    if (r.error) die(`deactivate ${slug}`, r.error);
  }
  for (const slug of ["mocion-pretermision-dhs", "evidencias-sustentatorias"]) {
    const r = await db.from("required_document_types").update({ is_active: false }).eq("service_phase_id", PHASE_ID).eq("slug", slug);
    if (r.error) die(`deactivate ${slug}`, r.error);
  }
  ok("deactivations", "brief(+qn), pretermisión, evidencias → is_active=false");

  // ── 4. EOIR-26: cambios de campo ───────────────────────────────────────────
  // #6 → texto fijo (client_answer + default_value); quitar ai_field
  await upd_q(EOIR.item6_qid, { source: "client_answer", source_ref: { default_value: "See attached Statement of Reasons for Appeal" } }, "eoir #6");
  // #12 método → default 'mailed_or_delivered' (abre #12B/#12C/#12D por defecto)
  await upd_q(EOIR.item12_method_qid, { source_ref: { default_value: "mailed_or_delivered" } }, "eoir #12 method");
  // #12(B) fecha → current_date
  await upd_q(EOIR.item12b_qid, { source: "current_date", source_ref: null }, "eoir #12B");
  // #12(C) destinatario → opción OPLA + default. is_required=false (tiene default,
  // nunca queda vacío) para no bloquear la generación cuando el grupo #12 se abre.
  await upd_q(EOIR.item12c_qid, {
    options: [
      { value: "OFFICE OF THE PRINCIPAL LEGAL ADVISOR (OPLA)", label_i18n: { es: "Office of the Principal Legal Advisor (OPLA)", en: "Office of the Principal Legal Advisor (OPLA)" } },
      { value: "Office of the Chief Counsel, DHS-ICE", label_i18n: { es: "Oficina del abogado del gobierno (Office of the Chief Counsel, DHS-ICE)", en: "Office of the Chief Counsel, DHS-ICE" } },
    ],
    source_ref: { default_value: "OFFICE OF THE PRINCIPAL LEGAL ADVISOR (OPLA)" },
    is_required: false,
    empty_policy: "blank",
    help_i18n: {
      es: "Se coloca por defecto la Office of the Principal Legal Advisor (OPLA), el abogado del gobierno ante quien se sirve la apelación.",
      en: "Defaults to the Office of the Principal Legal Advisor (OPLA), the government attorney served with the appeal.",
    },
  }, "eoir #12C");
  // #12(D) dirección → la ingresa el cliente/asesora (Dirección del Tribunal). NO
  // requerida (no debe bloquear la generación) y render en blanco; help con la URL EOIR.
  await upd_q(EOIR.item12d_qid, {
    is_required: false,
    empty_policy: "blank",
    help_i18n: {
      es: 'Dirección del Tribunal de Inmigración. Búscala en https://www.justice.gov/eoir/immigration-court-information (ítem "Dirección del Tribunal").',
      en: 'Immigration Court address. Look it up at https://www.justice.gov/eoir/immigration-court-information ("Court Address").',
    },
  }, "eoir #12D");
  // checklist Proof of Service + Receipt → marcados por defecto (EOIR-27 queda sin marcar)
  await upd_q(EOIR.proof_checkbox_qid, { source_ref: { default_value: true } }, "eoir checklist proof");
  await upd_q(EOIR.receipt_checkbox_qid, { source_ref: { default_value: true } }, "eoir checklist receipt");
  // #9 fecha de firma → nueva pregunta current_date (si no existe)
  {
    const { data: exists } = await db.from("form_questions").select("id").eq("group_id", EOIR.item9_group_id).eq("pdf_field_name", "9. Date_af_date").maybeSingle();
    if (!exists) {
      const r = await db.from("form_questions").insert({
        group_id: EOIR.item9_group_id, position: 1,
        question_i18n: { es: "Fecha de la firma (se llena con la fecha de hoy)", en: "Signature date (auto-filled with today's date)" },
        help_i18n: { es: "Se completa automáticamente con la fecha del día en que se genera el formulario.", en: "Auto-filled with the date the form is generated." },
        field_type: "date", options: null, source: "current_date", source_ref: null,
        is_required: false, validation: null, condition: null, pdf_field_name: "9. Date_af_date",
        empty_policy: "inherit", empty_placeholder: null, no_translate: true, ai_improve: null,
      });
      if (r.error) die("eoir #9 date insert", r.error);
      ok("eoir #9 date", "(insert current_date)");
    } else ok("eoir #9 date", "(ya existía)");
  }

  // ── 5. expediente_guidance (nuevo orden del paquete) ───────────────────────
  {
    const guidance = read("docs/_evidence/apelacion-ola3/expediente-guidance.txt");
    const r = await db.from("services").update({ expediente_guidance: guidance }).eq("slug", SERVICE_SLUG);
    if (r.error) die("expediente_guidance", r.error);
    ok("expediente_guidance", `${guidance.length} chars`);
  }

  console.log("\nDONE — Ola 3 (Statement of Reasons + Proof of Service) sembrada.");
})().catch((e) => die("unhandled", e));

async function upd_q(qid, patch, step) {
  const r = await db.from("form_questions").update(patch).eq("id", qid);
  if (r.error) die(step, r.error);
  ok(step);
}
