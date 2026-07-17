/* Ola 2 del Escrito de Apelación (BIA Appeal Brief) — siembra de configuración en PROD.
 *
 * Autorizado por Henry (2026-07-16, "Ola 2 completa"). Idempotente: cada paso
 * comprueba existencia por slug/clave única antes de insertar; re-ejecutar solo
 * actualiza los payloads de config (upsert). No toca casos ni datos de clientes.
 *
 * Crea/actualiza, en el servicio `apelacion` (fase-1):
 *  1. required_document_types.evidencias-sustentatorias (opcional, múltiple, ai_extract)
 *  2. form_definitions: escrito-de-apelacion (ai_letter) + escrito-de-apelacion-cuestionario
 *     (questionnaire, companion) — invariantes del companion replicados a mano:
 *     companion_questionnaire_id + requires_documents_complete heredado + input_form_slugs.
 *  3. form_automation_versions v1 published del cuestionario + 2 grupos + 7 preguntas base
 *     (clonando el shape de columnas de la versión del memo).
 *  4. ai_generation_configs del brief (drafts: system-prompt.txt, sections.json,
 *     research-instructions.txt) + assembly con carátula de corte.
 *  5. questionnaire_generation_configs (hybrid, drafts: cuestionario.md → prompt inline aquí).
 *  6. form_fill_guides ← docs/guides/escrito-de-apelacion-guia.md (enabled).
 *  7. ai_datasets "Precedentes de apelación BIA" + 9 precedentes verificados + 2 modelos.
 *
 * Uso:  node docs/_evidence/apelacion-brief/seed-ola2.cjs
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
const ORG_ID = "a3e5f333-455a-4b3b-a5da-5a3716d24761";

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SYSTEM_PROMPT = read("docs/_evidence/apelacion-brief/drafts/system-prompt.txt").trim();
const SECTIONS = JSON.parse(read("docs/_evidence/apelacion-brief/drafts/sections.json"));
const RESEARCH = read("docs/_evidence/apelacion-brief/drafts/research-instructions.txt").trim();
const GUIDE_MD = read("docs/guides/escrito-de-apelacion-guia.md");

const die = (step, error) => { console.error(`FAIL [${step}]:`, error?.message ?? error); process.exit(1); };
const ok = (step, extra = "") => console.log(`OK   [${step}] ${extra}`);

// generation_prompt del cuestionario (fuente: drafts/cuestionario.md §a)
const QN_GENERATION_PROMPT = `Servicio: APELACIÓN ANTE LA BIA (escrito de apelación / appeal brief). El juez de inmigración negó el caso del cliente; ya subió su paquete de asilo completo (tal como se presentó), la decisión y orden del juez y, opcionalmente, evidencias sustentatorias nuevas. Genera preguntas de PROFUNDIZACIÓN ancladas en esos documentos, para refutar la decisión: (a) por CADA evidencia sustentatoria nueva que haya subido — identifícala por su nombre de archivo, tal como aparece rotulada en el contexto — pregunta: ¿a qué incidente, afirmación o punto de tu caso de asilo pertenece y qué prueba exactamente?, ¿por qué no pudiste presentarla ante el juez antes de la audiencia? (por ejemplo: costaba dinero conseguirla, era imposible obtenerla desde tu país, no sabías que existía o que hacía falta, o es de fecha posterior a la audiencia) — NUNCA sugieras la respuesta ni justificaciones falsas; si no subió evidencias nuevas, NO generes preguntas de esta parte; (b) por cada motivo concreto que usó el juez para negar (los verás en la decisión: credibilidad, falta de conexión con un motivo protegido, protección del gobierno, reubicación interna, tercer país, CAT, etc.) pregunta: ¿qué respondes tú a ese motivo?, ¿qué hechos o documentos de tu expediente lo contradicen?; (c) ¿qué evidencias que SÍ estaban dentro de tu paquete de asilo crees que el juez no consideró o entendió mal, y qué probaban?; (d) datos de la audiencia que el escrito necesita: qué pasó ese día, si hubo problemas con el intérprete o con tu abogado, qué dijiste que no aparece o aparece mal resumido en la decisión, y quiénes declararon. Lenguaje simple y humano, sin tecnicismos legales; una idea por pregunta.`;

const BASE_QUESTIONS = [
  // [key, es, en, required, helpEs, helpEn]
  ["injusto", "¿Qué fue lo que te pareció más injusto o equivocado de la decisión del juez?", "What did you feel was most unfair or wrong about the judge's decision?", true,
   "Cuéntalo con tus palabras; no necesitas términos legales.", "Tell it in your own words; you don't need legal terms."],
  ["abogado-audiencia", "¿Tuviste abogado en tu audiencia? ¿Cómo fue esa representación?", "Did you have a lawyer at your hearing? How was that representation?", false,
   "Di si fuiste solo/a, o si tu abogado no presentó algo que tú querías presentar.", "Say if you went alone, or if your lawyer failed to present something you wanted presented."],
  ["interprete", "¿Hubo problemas con el intérprete o con la traducción durante tu audiencia?", "Were there problems with the interpreter or the translation during your hearing?", false,
   "Por ejemplo: no entendías las preguntas, tradujeron mal una fecha o un hecho importante.", "For example: you couldn't understand the questions, or a key date or fact was mistranslated."],
  ["no-aparece", "¿Dijiste algo importante en la audiencia que no aparece (o aparece mal contado) en la decisión del juez?", "Did you say something important at the hearing that is missing (or misstated) in the judge's decision?", true,
   "Qué dijiste, en qué momento, y cómo lo resumió mal la decisión.", "What you said, when, and how the decision misstates it."],
  ["evidencia-nueva", "¿Tienes evidencia nueva que no presentaste ante el juez? ¿Por qué no la presentaste antes?", "Do you have new evidence you did not present to the judge? Why didn't you present it before?", false,
   "Sé honesto/a: costaba conseguirla, no se podía obtener desde tu país, no sabías que existía, o es de fecha posterior. La razón real importa — no inventes.", "Be honest: it was costly to obtain, impossible to get from your country, you didn't know it existed, or it postdates the hearing. The real reason matters — do not invent one."],
  ["situacion-economica", "¿Cuál es tu situación económica actual (ingresos y gastos de tu hogar)?", "What is your current financial situation (your household's income and expenses)?", false,
   "Sirve para evaluar la exoneración de la tarifa de apelación ($1,030) más adelante.", "Used later to assess the appeal fee waiver ($1,030)."],
  ["algo-mas", "¿Hay algo más que tu equipo legal deba saber para tu apelación?", "Is there anything else your legal team should know for your appeal?", false,
   "Cualquier detalle, aunque parezca pequeño.", "Any detail, even if it seems small."],
];

const ASSEMBLY = {
  toc: true,
  cover: true,
  annexes: true,
  chronology: false,
  blocks: [
    { type: "cover", enabled: true },
    { type: "toc", enabled: true },
    { type: "body", enabled: true },
    { type: "chronology", enabled: false },
    { type: "conclusions", enabled: true },
    { type: "annexes", enabled: false },
    { type: "closing", enabled: true },
  ],
  closing:
    "CERTIFICATE OF SERVICE\n\nI hereby certify that on ______________, a true and complete copy of the foregoing Brief in Support of Appeal was served on the DHS Office of the Principal Legal Advisor at:\n\n______________________________\n\nSignature: ______________________________    Date: __________________",
  cover_page: {
    title: "BRIEF IN SUPPORT OF APPEAL FROM A DECISION OF AN IMMIGRATION JUDGE",
    rows: [
      { label: "Respondent / Appellant", value: "{{respondent_full_name}}" },
      { label: "A-Number of respondent", value: "{{a_number}}" },
      { label: "Immigration Court", value: "{{court_location}}" },
      { label: "Immigration Judge", value: "{{judge_name}}" },
      { label: "Decision appealed (date)", value: "{{decision_date}}" },
      { label: "Country of nationality", value: "{{nationality}}" },
    ],
  },
};

const EXTRACTION_SCHEMA = {
  type: "object",
  required: ["document_type"],
  properties: {
    document_type: { type: "string", description: "Kind of evidence (threat letter, police report, medical report, press article, witness letter, court or official record, photo set, other)" },
    title: { type: "string", description: "Short title or heading of the document, if any; null if none" },
    author_or_source: { type: "string", description: "Author, issuing office, or source; null if not stated" },
    document_date: { type: "string", description: "Date on the document (ISO 8601); null if none — prefer null over guessing" },
    summary: { type: "string", description: "One-paragraph summary of what this evidence shows" },
    claim_relevance_hint: { type: "string", description: "Which claim or incident of the asylum case this appears to support (hint only — the client confirms in the questionnaire); null if unclear" },
  },
};

// Dataset: 9 precedentes verificados por web (2026-07-16/17) + 2 modelos de estructura.
const P = (title, court, year, outcome, tags, citation, url, holding, usage) => ({
  title, jurisdiction: court, outcome, tags: ["apelacion", ...tags],
  content: `${holding}\n\nUso en el brief: ${usage}`,
  meta: { kind: "precedent", citation, court, year, url, holding },
});
const DATASET_ITEMS = [
  P("Matter of Z-Z-O-, 26 I&N Dec. 586 (BIA 2015)", "BIA", "2015", "remanded", ["standard-of-review"],
    "26 I&N Dec. 586", "https://www.justice.gov/eoir/volume-26",
    "An Immigration Judge's predictive findings of what may or may not occur in the future are findings of fact reviewed for CLEAR ERROR (overruling Matter of A-S-B-); the Board may not independently re-find facts, while legal questions remain de novo.",
    "autoridad ancla para encuadrar el estándar de revisión de CADA issue (hechos/credibilidad vs derecho)."),
  P("Cole v. Holder, 659 F.3d 762 (9th Cir. 2011)", "9th Cir.", "2011", "remanded", ["failure-to-consider-evidence", "cat"],
    "659 F.3d 762", "https://www.courtlistener.com/opinion/614073/cole-v-holder/",
    "Where potentially dispositive testimony and documentary evidence is submitted, the agency must give REASONED CONSIDERATION to it; the BIA erred by mischaracterizing the record, ignoring an expert entirely, and assessing CAT torture risk source-by-source instead of the AGGREGATE risk from all sources.",
    "Argument III (evidencia ignorada) y Argument IV (riesgo CAT agregado)."),
  P("Sagaydak v. Gonzales, 405 F.3d 1035 (9th Cir. 2005)", "9th Cir.", "2005", "remanded", ["failure-to-consider-evidence"],
    "405 F.3d 1035", "https://law.justia.com/cases/federal/appellate-courts/F3/405/1035/473466/",
    "IJs and the BIA are NOT free to ignore arguments raised by a petitioner; failure to address an argument requires remand for the agency to consider it.",
    "cita núcleo del Argument III cuando la decisión omitió argumentos o evidencia del record."),
  P("Madrigal v. Holder, 716 F.3d 499 (9th Cir. 2013)", "9th Cir.", "2013", "remanded", ["cat", "acquiescence"],
    "716 F.3d 499", "https://www.refworld.org/jurisprudence/caselaw/usaca9/2013/en/63343",
    "CAT acquiescence: it is legal error to focus on the government's WILLINGNESS to control the torturer rather than its ABILITY to do so; the applicant need not show that the entire foreign government would acquiesce.",
    "Argument IV cuando el IJ confundió voluntad con capacidad o exigió aquiescencia de todo el gobierno."),
  P("Matter of O-Z- & I-Z-, 22 I&N Dec. 23 (BIA 1998)", "BIA", "1998", "granted", ["cumulative-harm", "state-protection"],
    "22 I&N Dec. 23", "https://www.justice.gov/sites/default/files/eoir/legacy/2014/07/25/3346.pdf",
    "Incidents of harm must be considered CUMULATIVELY (beatings, vandalism and threats amounted to persecution in the aggregate); repeated police reports producing no action showed the government was unable or unwilling to protect.",
    "contra decisiones que atomizan el daño o ignoran denuncias sin respuesta."),
  P("Matter of A-G-G-, 25 I&N Dec. 486 (BIA 2011)", "BIA", "2011", "remanded", ["third-country", "firm-resettlement"],
    "25 I&N Dec. 486", "https://www.justice.gov/sites/default/files/eoir/legacy/2014/07/25/3713.pdf",
    "Framework for firm resettlement: DHS bears the INITIAL burden of a prima facie showing of an OFFER of permanent resettlement (direct evidence preferred; indirect evidence only with sufficient clarity and force).",
    "controla cualquier refutación de tercer país / firm resettlement (Argument V, solo si el record lo toca)."),
  P("Matter of Coelho, 20 I&N Dec. 464 (BIA 1992)", "BIA", "1992", "denied", ["motion-to-remand"],
    "20 I&N Dec. 464", "https://www.justice.gov/sites/default/files/eoir/legacy/2012/08/14/3172.pdf",
    "Motions to remand are subject to the same SUBSTANTIVE requirements as motions to reopen (material evidence, previously unavailable). Caveat: the oft-cited 'heavy burden' language is contextual (212(c) discretion) — do not overstate it against the client; the operative standard is 8 C.F.R. §1003.2(c).",
    "marco de la sección Motion to Remand (a11) para la evidencia nueva."),
  P("Shrestha v. Holder, 590 F.3d 1034 (9th Cir. 2010)", "9th Cir.", "2010", "denied", ["credibility", "standard-of-review"],
    "590 F.3d 1034", "https://www.courtlistener.com/opinion/1434187/shrestha-v-holder/",
    "REAL ID credibility framework: an adverse credibility determination must rest on the TOTALITY of the circumstances, be grounded in the record, rely on REAL problems with the testimony ('not mere trivialities'), and weigh any explanation offered for each inconsistency relied upon.",
    "caso de marco adverso — úsalo para mostrar qué exige un hallazgo adverso LÍCITO y por qué el del IJ no lo cumple (Argument II)."),
  P("Matter of S-M-J-, 21 I&N Dec. 722 (BIA 1997)", "BIA", "1997", "denied", ["corroboration", "credibility"],
    "21 I&N Dec. 722", "https://www.justice.gov/sites/default/files/eoir/legacy/2014/07/25/3303.pdf",
    "Corroboration framework (later codified by the REAL ID Act): credible testimony alone MAY satisfy the burden of proof; there is no presumption that the absence of corroboration alone defeats a claim; where corroborating evidence of material facts is reasonably expected/available it should be provided, and if not provided its absence should be explained.",
    "cuando el IJ sobre-exigió corroboración, ignoró la explicación de su ausencia, o trató la falta de un documento como derrota automática (Argument I/II)."),
  {
    title: "Modelo — estructura de Brief in Support of Appeal (direct appeal + motion to remand)",
    jurisdiction: "NGO model", outcome: "model", tags: ["apelacion", "estructura"],
    content: "Skeleton: (1) Introduction & Procedural History — who, court/IJ, decision date, relief denied, timely EOIR-26, roadmap. (2) Jurisdiction & Standards of Review — clear error for fact/credibility (Z-Z-O-), de novo for law; announce the standard per issue. (3) Statement of Facts strictly from the record, record-cited. (4) The IJ's grounds, enumerated faithfully — this list drives coverage (an unchallenged ground is waived). (5) Summary of Argument, 1:1 with the arguments. (6-10) Arguments: legal errors (de novo); clearly-erroneous fact/credibility findings; record evidence overlooked; CAT separately (aggregate risk, acquiescence); third-country only if the decision relied on it. (11) Motion to Remand for new evidence under 8 C.F.R. 1003.2(c): per item — what it is, which claim it reinforces, materiality, honest unavailability. (12) Precedent applied with direct factual analogies. (13) Conclusion & Prayer: sustain, vacate/reverse, grant or remand.",
    meta: { kind: "model" },
  },
  {
    title: "Modelo — párrafo de analogía fáctica (precedente → caso)",
    jurisdiction: "NGO model", outcome: "model", tags: ["apelacion", "estructura"],
    content: "Template: 'In [Case], [Court] held that [holding]. [Citation]. The record here presents the same defect: [record fact with cite]. As in [Case], the IJ [same error]. Because [holding] controls, the same result — [reversal/remand] — follows.' Always: cite → holding → THIS record's facts → why the holding compels the outcome. Never restate the holding without applying it to the appellant's specific facts.",
    meta: { kind: "model" },
  },
];

(async () => {
  // ── 1. Documento evidencias-sustentatorias ─────────────────────────────────
  {
    const { data: existing } = await db.from("required_document_types").select("id").eq("service_phase_id", PHASE_ID).eq("slug", "evidencias-sustentatorias").maybeSingle();
    const row = {
      service_phase_id: PHASE_ID,
      slug: "evidencias-sustentatorias",
      label_i18n: { es: "Evidencias sustentatorias", en: "Supporting evidence" },
      help_i18n: {
        es: "Sube cada evidencia nueva que respalde tu apelación (cartas, denuncias, informes médicos, artículos, fotos — en PDF). Puedes subir varias; cada archivo por separado.",
        en: "Upload each new piece of evidence supporting your appeal (letters, reports, medical records, articles, photos — as PDF). You can upload several; one file each.",
      },
      category_i18n: { es: "Evidencias", en: "Evidence" },
      is_required: false,
      is_per_party: false,
      party_roles: null,
      ai_extract: true,
      extraction_schema: EXTRACTION_SCHEMA,
      requires_translation: true,
      requires_certified_copy: false,
      position: 3,
      is_active: true,
      accepted_format: "pdf",
      allow_multiple: true,
    };
    const r = existing
      ? await db.from("required_document_types").update(row).eq("id", existing.id)
      : await db.from("required_document_types").insert(row);
    if (r.error) die("1 evidencias-sustentatorias", r.error);
    ok("1 evidencias-sustentatorias", existing ? "(update)" : "(insert)");
  }

  // ── 2. form_definitions (ai_letter + questionnaire companion) ──────────────
  const upsertFd = async (row) => {
    const { data: existing } = await db.from("form_definitions").select("id").eq("service_phase_id", PHASE_ID).eq("slug", row.slug).maybeSingle();
    if (existing) {
      const r = await db.from("form_definitions").update(row).eq("id", existing.id);
      if (r.error) die(`2 fd ${row.slug}`, r.error);
      return existing.id;
    }
    const r = await db.from("form_definitions").insert(row).select("id").single();
    if (r.error) die(`2 fd ${row.slug}`, r.error);
    return r.data.id;
  };
  const briefId = await upsertFd({
    service_phase_id: PHASE_ID,
    slug: "escrito-de-apelacion",
    kind: "ai_letter",
    label_i18n: { es: "Escrito de Apelación (BIA)", en: "Brief in Support of Appeal (BIA)" },
    description_i18n: {
      es: "Escrito legal que refuta los motivos del juez de inmigración ante la Junta de Apelaciones (BIA). Se genera con IA a partir de tu expediente y tus respuestas, y tu equipo legal lo revisa.",
      en: "Legal brief refuting the Immigration Judge's grounds before the Board of Immigration Appeals (BIA). AI-drafted from your record and your answers, then reviewed by your legal team.",
    },
    filled_by: "client",
    is_per_party: false,
    party_roles: null,
    position: 1,
    is_active: true,
    requires_documents_complete: true,
  });
  ok("2 fd escrito-de-apelacion", briefId);
  const qnId = await upsertFd({
    service_phase_id: PHASE_ID,
    slug: "escrito-de-apelacion-cuestionario",
    kind: "questionnaire",
    label_i18n: { es: "Escrito de Apelación — Cuestionario", en: "Appeal Brief — Questionnaire" },
    description_i18n: {
      es: "Preguntas para preparar tu apelación: qué decidió mal el juez, qué evidencia lo contradice y qué evidencia nueva tienes.",
      en: "Questions to prepare your appeal: what the judge got wrong, what evidence contradicts it, and what new evidence you have.",
    },
    filled_by: "client",
    is_per_party: false,
    party_roles: null,
    position: 2,
    is_active: true,
    requires_documents_complete: true, // heredado del ai_letter (invariante de ensureCompanionQuestionnaire)
  });
  ok("2 fd escrito-de-apelacion-cuestionario", qnId);
  {
    const r = await db.from("form_definitions").update({ companion_questionnaire_id: qnId }).eq("id", briefId);
    if (r.error) die("2 companion link", r.error);
    ok("2 companion link");
  }

  // ── 3. Versión published del cuestionario + grupos + 7 preguntas base ──────
  {
    const { data: existingVer } = await db.from("form_automation_versions").select("id, status").eq("form_definition_id", qnId).eq("status", "published").maybeSingle();
    let verId = existingVer?.id;
    if (!verId) {
      // Clona el shape de la versión published del cuestionario del memo.
      const { data: tpl, error: tplErr } = await db.from("form_automation_versions").select("*").eq("id", "a45644eb-a7bd-4b28-9391-11f572da0678").single();
      if (tplErr) die("3 version template", tplErr);
      const row = { ...tpl };
      delete row.id; delete row.created_at; delete row.updated_at;
      row.form_definition_id = qnId;
      row.version = 1;
      row.status = "published";
      row.source_pdf_path = null;
      row.detected_fields = [];
      const r = await db.from("form_automation_versions").insert(row).select("id").single();
      if (r.error) die("3 version insert", r.error);
      verId = r.data.id;
    }
    ok("3 version published", verId);

    const { data: existingGroups } = await db.from("form_question_groups").select("id").eq("automation_version_id", verId);
    if ((existingGroups ?? []).length === 0) {
      const g1 = await db.from("form_question_groups").insert({
        automation_version_id: verId, position: 0, do_not_fill: false,
        title_i18n: { es: "Tu audiencia y la decisión del juez", en: "Your hearing and the judge's decision" },
      }).select("id").single();
      if (g1.error) die("3 group 1", g1.error);
      const g2 = await db.from("form_question_groups").insert({
        automation_version_id: verId, position: 1, do_not_fill: false,
        title_i18n: { es: "Evidencia nueva y tu situación", en: "New evidence and your situation" },
      }).select("id").single();
      if (g2.error) die("3 group 2", g2.error);
      const groupFor = (i) => (i < 4 ? g1.data.id : g2.data.id);
      const rows = BASE_QUESTIONS.map(([key, es, en, required, helpEs, helpEn], i) => ({
        group_id: groupFor(i),
        position: i < 4 ? i : i - 4,
        question_i18n: { es, en },
        help_i18n: { es: helpEs, en: helpEn },
        field_type: "textarea",
        options: null,
        source: "client_answer",
        source_ref: null,
        is_required: required,
        validation: null,
        condition: null,
        pdf_field_name: null,
        empty_policy: "inherit",
        empty_placeholder: null,
        no_translate: false,
        ai_improve: null,
      }));
      const r = await db.from("form_questions").insert(rows);
      if (r.error) die("3 base questions", r.error);
      ok("3 base questions", `${rows.length} preguntas (keys: ${BASE_QUESTIONS.map((q) => q[0]).join(", ")})`);
    } else {
      ok("3 base questions", "(ya existían — sin cambios)");
    }
  }

  // ── 7 (antes para tener el id). Dataset "Precedentes de apelación BIA" ─────
  let datasetId;
  {
    const { data: existing } = await db.from("ai_datasets").select("id").eq("org_id", ORG_ID).eq("name", "Precedentes de apelación BIA").maybeSingle();
    if (existing) datasetId = existing.id;
    else {
      const r = await db.from("ai_datasets").insert({
        org_id: ORG_ID,
        name: "Precedentes de apelación BIA",
        purpose: "Apelaciones/remands ganados ante la BIA y circuitos, agrupados por tipo de error del IJ — guía de derecho y estructura para el Brief in Support of Appeal",
        source_kind: "court_public",
        is_active: true,
      }).select("id").single();
      if (r.error) die("7 dataset", r.error);
      datasetId = r.data.id;
    }
    ok("7 dataset", datasetId);

    const { data: existingItems } = await db.from("ai_dataset_items").select("title").eq("dataset_id", datasetId);
    const have = new Set((existingItems ?? []).map((i) => i.title));
    const fresh = DATASET_ITEMS.filter((i) => !have.has(i.title)).map((i) => ({
      dataset_id: datasetId,
      title: i.title,
      jurisdiction: i.jurisdiction,
      outcome: i.outcome,
      content: i.content,
      tags: i.tags,
      token_count: Math.ceil(i.content.length / 4),
      meta: i.meta,
    }));
    if (fresh.length > 0) {
      const r = await db.from("ai_dataset_items").insert(fresh);
      if (r.error) die("7 dataset items", r.error);
    }
    ok("7 dataset items", `${fresh.length} nuevos / ${DATASET_ITEMS.length} totales`);
  }

  // ── 4. ai_generation_configs del brief ─────────────────────────────────────
  {
    const row = {
      form_definition_id: briefId,
      system_prompt: SYSTEM_PROMPT,
      input_document_slugs: ["asilo-presentado-completo-con-anexos", "decision-y-orden-del-juez-de-inmigracion", "evidencias-sustentatorias"],
      input_form_slugs: ["escrito-de-apelacion-cuestionario"],
      dataset_id: datasetId,
      model: "claude-sonnet-4-6",
      max_output_tokens: 16000,
      output_format: "pdf",
      output_language: "en",
      web_search_enabled: true,
      web_search_max_uses: 6,
      research_instructions: RESEARCH,
      research_model: "claude-opus-4-7",
      sections: SECTIONS,
      rules_enabled: true,
      rules_text: null,
      assembly: ASSEMBLY,
      attach_sources_enabled: true,
      attach_sources_kinds: ["country_condition", "jurisprudence", "admin_curated", "dataset"],
      curated_sources: [],
    };
    const { data: existing } = await db.from("ai_generation_configs").select("form_definition_id").eq("form_definition_id", briefId).maybeSingle();
    const r = existing
      ? await db.from("ai_generation_configs").update(row).eq("form_definition_id", briefId)
      : await db.from("ai_generation_configs").insert(row);
    if (r.error) die("4 ai_generation_configs", r.error);
    ok("4 ai_generation_configs", `${SECTIONS.length} secciones, dataset ${datasetId.slice(0, 8)}…`);
  }

  // ── 5. questionnaire_generation_configs ────────────────────────────────────
  {
    const row = {
      form_definition_id: qnId,
      mode: "hybrid",
      generation_prompt: QN_GENERATION_PROMPT,
      input_document_slugs: ["asilo-presentado-completo-con-anexos", "decision-y-orden-del-juez-de-inmigracion", "evidencias-sustentatorias"],
      input_form_slugs: [],
      prerequisite_form_slugs: [],
      prerequisite_document_slugs: ["asilo-presentado-completo-con-anexos", "decision-y-orden-del-juez-de-inmigracion"],
      target_question_count: 18,
      model: "claude-sonnet-4-6",
      hybrid_layout: "append_group",
      auto_trigger: true,
      allow_client_trigger: false,
      on_new_evidence: "flag",
    };
    const { data: existing } = await db.from("questionnaire_generation_configs").select("form_definition_id").eq("form_definition_id", qnId).maybeSingle();
    const r = existing
      ? await db.from("questionnaire_generation_configs").update(row).eq("form_definition_id", qnId)
      : await db.from("questionnaire_generation_configs").insert(row);
    if (r.error) die("5 questionnaire_generation_configs", r.error);
    ok("5 questionnaire_generation_configs");
  }

  // ── 6. Rúbrica Pre-Mortem del brief ─────────────────────────────────────────
  {
    const row = {
      form_definition_id: briefId,
      guide_markdown: GUIDE_MD,
      source_file_path: "docs/guides/escrito-de-apelacion-guia.md",
      enabled: true,
    };
    const { data: existing } = await db.from("form_fill_guides").select("form_definition_id").eq("form_definition_id", briefId).maybeSingle();
    const r = existing
      ? await db.from("form_fill_guides").update(row).eq("form_definition_id", briefId)
      : await db.from("form_fill_guides").insert(row);
    if (r.error) die("6 form_fill_guides", r.error);
    ok("6 form_fill_guides", `${GUIDE_MD.length} chars, enabled`);
  }

  // ── Verificación final ──────────────────────────────────────────────────────
  const { data: verify } = await db
    .from("form_definitions")
    .select("slug, kind, position, is_active, requires_documents_complete, companion_questionnaire_id")
    .eq("service_phase_id", PHASE_ID)
    .order("position");
  console.log("\nVERIFY form_definitions(apelacion/fase-1):", JSON.stringify(verify, null, 2));
  const { data: verifyDocs } = await db
    .from("required_document_types")
    .select("slug, is_required, allow_multiple, ai_extract, requires_translation, position")
    .eq("service_phase_id", PHASE_ID)
    .order("position");
  console.log("VERIFY required_document_types:", JSON.stringify(verifyDocs, null, 2));
  console.log("\nDONE — Ola 2 sembrada.");
})().catch((e) => die("unhandled", e));
