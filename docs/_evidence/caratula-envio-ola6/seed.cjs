/*
 * Ola 6 — "Carátula de Envío" (USPS mailing cover sheet) para el servicio apelación.
 * Siembra de configuración config-as-data en PRODUCCIÓN, IDEMPOTENTE.
 *
 * Crea/actualiza, en el servicio `apelacion` (fase-1):
 *  1. form_definitions: `caratula-de-envio` (ai_letter) + `caratula-de-envio-cuestionario`
 *     (questionnaire companion, enlazado por companion_questionnaire_id).
 *  2. Versión published del cuestionario + 1 grupo + 2 preguntas `field_copy`:
 *       - "Nombre completo del cliente (como aparece en el sobre)"  → EOIR-26 "10. Name"
 *       - "Dirección de OPLA (del buscador IA)"                     → EOIR-26 "12. Address"
 *     (ambas copian una respuesta YA capturada — el cliente no re-escribe nada).
 *  3. ai_generation_configs con `mailing_cover`: su PRESENCIA enruta la generación al
 *     render DETERMINISTA (sin IA) y la antepone como hoja 1 del expediente (antes del
 *     índice). return_address fija (firma) + 2 sobres (BIA fijo · OPLA con dirección
 *     variable copiada del buscador) + espaciado.
 *
 * REQUIERE:
 *   - migración 0105 aplicada (columna ai_generation_configs.mailing_cover jsonb).
 *   - migración 0104 aplicada (source='field_copy' en form_questions — ya en PROD).
 * NO toca casos ni datos de clientes.
 *
 * Uso:  node docs/_evidence/caratula-envio-ola6/seed.cjs
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

// The two questionnaire questions. The `question` (es) wording is the KEY the mailing
// cover references — loadResolvedInputs re-keys answers by es wording, so these MUST
// match the mailing_cover.sender_name/address_from.question values below verbatim.
const Q_NAME = "Nombre completo del cliente (como aparece en el sobre)";
const Q_OPLA = "Dirección de OPLA (del buscador IA)";

const MAILING_COVER = {
  return_address: ["10951 N. Town Center Drive", "Highland, UT 84003"],
  sender_name: { form_slug: "caratula-de-envio-cuestionario", question: Q_NAME },
  envelopes: [
    {
      recipient_lines: ["Board of Immigration Appeals", "5107 Leesburg Pike, Suite 2000", "Falls Church, VA 22041"],
      address_from: null,
    },
    {
      recipient_lines: ["Office of the Principal Legal Advisor (OPLA)", "U.S. Immigration and Customs Enforcement"],
      address_from: { form_slug: "caratula-de-envio-cuestionario", question: Q_OPLA },
    },
  ],
  spacing: { block_gap_pt: 120, line_height: 1.5, font_size_pt: 13, margin_pt: 96 },
};

async function publishedVersionId(slug) {
  const { data: fd } = await db.from("form_definitions").select("id").eq("service_phase_id", PHASE_ID).eq("slug", slug).maybeSingle();
  if (!fd) die(`fd ${slug}`, "form_definition not found");
  const { data: ver } = await db.from("form_automation_versions").select("*").eq("form_definition_id", fd.id).eq("status", "published").maybeSingle();
  if (!ver) die(`ver ${slug}`, "no published version");
  return ver;
}

async function eoirQuestionIdByPdf(pdfName) {
  const eoir = await publishedVersionId("eoir-26");
  const { data: groups } = await db.from("form_question_groups").select("id").eq("automation_version_id", eoir.id);
  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: qs } = await db.from("form_questions").select("id, pdf_field_name").in("group_id", groupIds);
  const q = (qs ?? []).find((x) => x.pdf_field_name === pdfName);
  if (!q) die(`eoir ${pdfName}`, "question not found in eoir-26 published version");
  return q.id;
}

const upsertFd = async (row) => {
  const { data: existing } = await db.from("form_definitions").select("id").eq("service_phase_id", PHASE_ID).eq("slug", row.slug).maybeSingle();
  if (existing) {
    const r = await db.from("form_definitions").update(row).eq("id", existing.id);
    if (r.error) die(`fd ${row.slug}`, r.error);
    return existing.id;
  }
  const r = await db.from("form_definitions").insert(row).select("id").single();
  if (r.error) die(`fd ${row.slug}`, r.error);
  return r.data.id;
};

(async () => {
  // Resolve the EOIR-26 field_copy targets (current published version).
  const nameTargetId = await eoirQuestionIdByPdf("10. Name");
  const oplaTargetId = await eoirQuestionIdByPdf("12. Address");
  ok("eoir targets", `name=${nameTargetId.slice(0, 8)}… opla=${oplaTargetId.slice(0, 8)}…`);

  // ── 1. form_definitions (ai_letter + questionnaire companion) ───────────────
  const coverId = await upsertFd({
    service_phase_id: PHASE_ID,
    slug: "caratula-de-envio",
    kind: "ai_letter",
    label_i18n: { es: "Carátula de Envío", en: "Mailing Cover Sheet" },
    description_i18n: {
      es: "Hoja de envío postal (dos sobres: BIA y OPLA) que encabeza tu expediente. Se completa sola con tu nombre y la dirección de OPLA que ya buscaste; solo revísala.",
      en: "Mailing cover sheet (two envelopes: BIA and OPLA) that heads your file. Auto-filled with your name and the OPLA address you already searched; just review it.",
    },
    filled_by: "client",
    is_per_party: false,
    party_roles: null,
    position: 5,
    is_active: true,
    requires_documents_complete: false,
  });
  ok("1 fd caratula-de-envio", coverId);

  const qnId = await upsertFd({
    service_phase_id: PHASE_ID,
    slug: "caratula-de-envio-cuestionario",
    kind: "questionnaire",
    label_i18n: { es: "Carátula de Envío — Cuestionario", en: "Mailing Cover — Questionnaire" },
    description_i18n: {
      es: "Dos datos, ambos ya capturados: tu nombre y la dirección de OPLA. Solo confírmalos.",
      en: "Two values, both already captured: your name and the OPLA address. Just confirm them.",
    },
    filled_by: "client",
    is_per_party: false,
    party_roles: null,
    position: 6,
    is_active: true,
    requires_documents_complete: false,
  });
  ok("1 fd caratula-de-envio-cuestionario", qnId);
  {
    const r = await db.from("form_definitions").update({ companion_questionnaire_id: qnId }).eq("id", coverId);
    if (r.error) die("1 companion link", r.error);
    ok("1 companion link");
  }

  // ── 2. Versión published del cuestionario + grupo + 2 preguntas field_copy ──
  {
    const { data: existingVer } = await db.from("form_automation_versions").select("id").eq("form_definition_id", qnId).eq("status", "published").maybeSingle();
    let verId = existingVer?.id;
    if (!verId) {
      // Clona el shape de columnas de una versión de cuestionario existente.
      const tpl = await publishedVersionId("proof-of-service-cuestionario");
      const row = { ...tpl };
      delete row.id; delete row.created_at; delete row.updated_at;
      row.form_definition_id = qnId;
      row.version = 1;
      row.status = "published";
      row.source_pdf_path = null;
      row.detected_fields = [];
      const r = await db.from("form_automation_versions").insert(row).select("id").single();
      if (r.error) die("2 version insert", r.error);
      verId = r.data.id;
    }
    ok("2 version published", verId);

    const { data: existingGroups } = await db.from("form_question_groups").select("id").eq("automation_version_id", verId);
    let groupId = (existingGroups ?? [])[0]?.id;
    if (!groupId) {
      const g = await db.from("form_question_groups").insert({
        automation_version_id: verId, position: 0, do_not_fill: false,
        title_i18n: { es: "Datos del envío", en: "Mailing details" },
      }).select("id").single();
      if (g.error) die("2 group", g.error);
      groupId = g.data.id;
    }

    const { data: existingQs } = await db.from("form_questions").select("id, question_i18n").eq("group_id", groupId);
    const haveQ = new Set((existingQs ?? []).map((q) => q.question_i18n?.es));
    const QUESTIONS = [
      {
        position: 0,
        field_type: "text",
        question_i18n: { es: Q_NAME, en: "Client's full name (as it appears on the envelope)" },
        help_i18n: {
          es: "Se copia de tu EOIR-26 (a nombre de quién llega tu correo). Verifica que esté bien escrito.",
          en: "Copied from your EOIR-26 (whose name your mail arrives under). Check the spelling.",
        },
        source: "field_copy",
        source_ref: { form_slug: "eoir-26", target_question_id: nameTargetId, target_pdf_field_name: "10. Name" },
      },
      {
        position: 1,
        field_type: "textarea",
        question_i18n: { es: Q_OPLA, en: "OPLA address (from the AI search)" },
        help_i18n: {
          es: "Se copia de la dirección de OPLA que ya buscaste con el buscador IA en el EOIR-26 (ítem #12).",
          en: "Copied from the OPLA address you already found with the AI search on the EOIR-26 (item #12).",
        },
        source: "field_copy",
        source_ref: { form_slug: "eoir-26", target_question_id: oplaTargetId, target_pdf_field_name: "12. Address" },
      },
    ];
    const fresh = QUESTIONS.filter((q) => !haveQ.has(q.question_i18n.es)).map((q) => ({
      group_id: groupId,
      position: q.position,
      question_i18n: q.question_i18n,
      help_i18n: q.help_i18n,
      field_type: q.field_type,
      options: null,
      source: q.source,
      source_ref: q.source_ref,
      is_required: false,
      validation: null,
      condition: null,
      pdf_field_name: null,
      empty_policy: "blank",
      empty_placeholder: null,
      no_translate: true,
      ai_improve: null,
    }));
    if (fresh.length > 0) {
      const r = await db.from("form_questions").insert(fresh);
      if (r.error) die("2 questions", r.error);
    }
    ok("2 questions", `${fresh.length} nuevas / ${QUESTIONS.length} totales`);
  }

  // ── 3. ai_generation_configs con mailing_cover ──────────────────────────────
  {
    const row = {
      form_definition_id: coverId,
      // system_prompt is required (not null / min 1) but UNUSED for a mailing cover —
      // the presence of mailing_cover short-circuits to the deterministic renderer.
      system_prompt: "Deterministic mailing cover — rendered without the model (see ai_generation_configs.mailing_cover).",
      input_document_slugs: [],
      input_form_slugs: ["caratula-de-envio-cuestionario"],
      dataset_id: null,
      model: "claude-fable-5", // valid whitelist value; no LLM call is made
      max_output_tokens: 2000,
      output_format: "pdf",
      output_language: "en",
      web_search_enabled: false,
      web_search_max_uses: 3,
      research_instructions: null,
      research_model: null,
      sections: [],
      rules_enabled: false,
      rules_text: null,
      assembly: null,
      attach_sources_enabled: false,
      attach_sources_kinds: [],
      curated_sources: [],
      mailing_cover: MAILING_COVER,
    };
    const { data: existing } = await db.from("ai_generation_configs").select("form_definition_id").eq("form_definition_id", coverId).maybeSingle();
    const r = existing
      ? await db.from("ai_generation_configs").update(row).eq("form_definition_id", coverId)
      : await db.from("ai_generation_configs").insert(row);
    if (r.error) die("3 ai_generation_configs", r.error);
    ok("3 ai_generation_configs", `${MAILING_COVER.envelopes.length} sobres`);
  }

  // ── Verificación final ──────────────────────────────────────────────────────
  const { data: verify } = await db
    .from("form_definitions")
    .select("slug, kind, position, is_active, companion_questionnaire_id")
    .eq("service_phase_id", PHASE_ID)
    .order("position");
  console.log("\nVERIFY form_definitions(apelacion/fase-1):", JSON.stringify(verify, null, 2));
  console.log("\nDONE — Carátula de Envío sembrada.");
})().catch((e) => die("unhandled", e));
