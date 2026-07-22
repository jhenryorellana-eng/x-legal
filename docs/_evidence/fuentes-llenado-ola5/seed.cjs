/*
 * Ola 5 — "4 fuentes de llenado" (web_research + field_copy). Aplica de forma
 * IDEMPOTENTE los 3 cambios de configuración config-as-data sobre PRODUCCIÓN:
 *
 *   1. EOIR-26 ítem #10 (dirección + teléfono): las respuestas dejan de salir de la
 *      extracción del I-589 y pasan a salir del CONTRATO (perfil capturado al crear el
 *      caso), vía source='profile':
 *        - "Street Address"           → profile address.line1
 *        - "Apartment or Room Number" → profile address.apartment
 *        - "City State Zip Code"      → profile address.city_state_zip  (sintético "City, ST ZIP")
 *        - "Telephone Number"         → profile phone_e164  (format us_phone → "(305) 555-1234")
 *      (El nombre del ítem #10 se mantiene desde la decisión del juez — debe coincidir
 *       con el expediente EOIR.)
 *
 *   2. EOIR-26 ítem #12 ("12. Address", "¿A qué dirección se envió la copia?"): pasa a
 *      source='web_research' (buscador + IA). system prompt configurable con {{INPUT}},
 *      reference_url a la guía de oficinas de ICE/OPLA, y help dinámico con los tokens
 *      {{a_number}} (extracción de la decisión del juez) y {{nationality}} (I-589 pág 1).
 *
 *   3. Constancia de Notificación (encuesta proof-of-service-cuestionario), pregunta
 *      "¿Cuál es la dirección de la oficina del Chief Counsel (DHS/OPLA)?": pasa a
 *      source='field_copy' copiando la respuesta del ítem #12 del EOIR-26. Se materializa
 *      al enviar el cuestionario → la carta Proof of Service la usa vía letter_fill.
 *
 * REQUIERE la migración 0104 aplicada (nuevo CHECK de form_questions.source con
 * 'web_research' + 'field_copy'). NO toca casos ni datos de clientes.
 *
 * Uso:  node docs/_evidence/fuentes-llenado-ola5/seed.cjs
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

const DECISION_DOC = "decision-y-orden-del-juez-de-inmigracion";
const ASYLUM_DOC = "asilo-presentado-completo-con-anexos";

const die = (step, error) => { console.error(`FAIL [${step}]:`, error?.message ?? error); process.exit(1); };
const ok = (step, extra = "") => console.log(`OK   [${step}] ${extra}`);

async function publishedVersionId(slug) {
  const { data: fd } = await db.from("form_definitions").select("id").eq("service_phase_id", PHASE_ID).eq("slug", slug).maybeSingle();
  if (!fd) die(`fd ${slug}`, "form_definition not found");
  const { data: ver } = await db.from("form_automation_versions").select("id").eq("form_definition_id", fd.id).eq("status", "published").maybeSingle();
  if (!ver) die(`ver ${slug}`, "no published version");
  return ver.id;
}

/** All questions of a published version, with group + pdf_field_name + question text. */
async function questionsOf(versionId) {
  const { data: groups } = await db.from("form_question_groups").select("id").eq("automation_version_id", versionId);
  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: qs, error } = await db.from("form_questions")
    .select("id, pdf_field_name, question_i18n, source").in("group_id", groupIds);
  if (error) die("questions", error);
  return qs ?? [];
}

async function updateQuestion(id, patch, step) {
  const r = await db.from("form_questions").update(patch).eq("id", id);
  if (r.error) die(step, r.error);
  ok(step);
}

// --- item #12 web_research config ------------------------------------------
const WEB_RESEARCH_REF = {
  system_prompt_template:
    "Esta es la direccion del corte del juez {{INPUT}}, y con esa direccion buscame la direccion del fiscal principal para enviarle la copia de Proof of Service",
  reference_url: "https://www.ice.gov/contact/field-offices?office=12",
  // 3 rounds keeps a typical lookup ~30-45s, under the platform's Server-Action gateway
  // limit (a 504 was observed with 5 rounds taking ~65s). See WEB_RESEARCH_TIMEOUT_MS.
  max_uses: 3,
  search_label_i18n: {
    es: "Dirección del tribunal (pégala y presiona Buscar)",
    en: "Court address (paste it and press Search)",
  },
  result_label_i18n: {
    es: "Dirección del fiscal — Office of the Chief Counsel (DHS/OPLA)",
    en: "Prosecutor's address — Office of the Chief Counsel (DHS/OPLA)",
  },
  help_tokens: {
    a_number: { document_slug: DECISION_DOC, json_path: "a_number" },
    nationality: { document_slug: ASYLUM_DOC, json_path: "country_of_nationality" },
  },
};
const ITEM12_HELP = {
  es: "Ve a https://acis.eoir.justice.gov/es/ e ingresa tu Número A {{a_number}} y tu nacionalidad {{nationality}}; copia lo que dice “dirección del tribunal” y pégalo en el buscador de arriba. La IA devolverá la dirección del fiscal (Office of the Chief Counsel / OPLA) a la que se envía la copia de la apelación.",
  en: "Go to https://acis.eoir.justice.gov/es/ and enter your A-Number {{a_number}} and nationality {{nationality}}; copy the “court address” and paste it into the search box above. The AI returns the prosecutor's address (Office of the Chief Counsel / OPLA) the appeal copy is served to.",
};

// item #10 — new help (no longer references the I-589; it now comes from the contract)
const ITEM10_HELP = {
  "Street Address": {
    es: "Se llena con la dirección que registraste al abrir tu caso. VERIFICA que sea tu dirección ACTUAL — si te mudaste, corrígela. Todo cambio se avisa a la BIA en 5 días hábiles (EOIR-33/BIA).",
    en: "Filled from the address you registered when your case was opened. VERIFY it is your CURRENT address — if you moved, correct it. Any change must be reported to the BIA within 5 business days (EOIR-33/BIA).",
  },
  "Apartment or Room Number": {
    es: "Se llena con el apartamento/cuarto que registraste al abrir tu caso. Déjalo en blanco si no aplica.",
    en: "Filled from the apartment/room you registered when your case was opened. Leave blank if not applicable.",
  },
  "City State Zip Code": {
    es: "Se llena con la ciudad, estado y código postal que registraste al abrir tu caso (ej. Houston, TX 77096). VERIFICA que sean los actuales.",
    en: "Filled from the city, state and ZIP you registered when your case was opened (e.g. Houston, TX 77096). VERIFY they are current.",
  },
  "Telephone Number": {
    es: "Se llena con el teléfono que registraste al abrir tu caso. VERIFICA que siga siendo tu número. Todo cambio se avisa a la BIA en 5 días hábiles (EOIR-33/BIA).",
    en: "Filled from the phone you registered when your case was opened. VERIFY it is still your number. Any change must be reported to the BIA within 5 business days (EOIR-33/BIA).",
  },
};
const ITEM10_PROFILE = {
  "Street Address": { profile_field: "address.line1" },
  "Apartment or Room Number": { profile_field: "address.apartment" },
  "City State Zip Code": { profile_field: "address.city_state_zip" },
  "Telephone Number": { profile_field: "phone_e164", format: "us_phone" },
};

(async () => {
  // --- EOIR-26 ---------------------------------------------------------------
  const eoirVer = await publishedVersionId("eoir-26");
  const eoirQs = await questionsOf(eoirVer);
  const byPdf = (name) => eoirQs.find((q) => q.pdf_field_name === name);

  // 1. item #10 → contract (profile)
  for (const [pdfName, ref] of Object.entries(ITEM10_PROFILE)) {
    const q = byPdf(pdfName);
    if (!q) die(`item10 ${pdfName}`, "question not found");
    await updateQuestion(q.id, { source: "profile", source_ref: ref, help_i18n: ITEM10_HELP[pdfName] }, `item10 ${pdfName} → profile`);
  }

  // 2. item #12 "12. Address" → web_research
  const item12 = byPdf("12. Address");
  if (!item12) die("item12", "question '12. Address' not found");
  await updateQuestion(item12.id, { source: "web_research", source_ref: WEB_RESEARCH_REF, help_i18n: ITEM12_HELP, is_required: false, empty_policy: "blank" }, "item12 → web_research");

  // --- Constancia de Notificación -------------------------------------------
  const proofVer = await publishedVersionId("proof-of-service-cuestionario");
  const proofQs = await questionsOf(proofVer);
  const chief = proofQs.find((q) => (q.question_i18n?.es ?? "").includes("Chief Counsel"));
  if (!chief) die("chief counsel", "question not found in proof-of-service-cuestionario");

  // 3. Chief Counsel → field_copy from EOIR-26 item #12
  await updateQuestion(
    chief.id,
    {
      source: "field_copy",
      source_ref: { form_slug: "eoir-26", target_question_id: item12.id, target_pdf_field_name: "12. Address" },
    },
    "chief counsel → field_copy(eoir-26 #12)",
  );

  console.log("\nDONE — 3 config changes applied idempotently.");
  console.log(`  EOIR-26 item #10: 4 fields → profile (contract)`);
  console.log(`  EOIR-26 item #12: ${item12.id} → web_research`);
  console.log(`  Constancia Chief Counsel: ${chief.id} → field_copy → ${item12.id}`);
})();
