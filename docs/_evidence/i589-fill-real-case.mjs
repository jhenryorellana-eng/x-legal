/* Reconstruye el caso Karelis como un caso de asilo REAL, coherente, aprobable y en INGLÉS.
 * Aplica todas las correcciones: barreras (Part C) en No, narrativas distintas por pregunta,
 * sexo Femenino, residencia US real, cónyuge/hijos distintos, direcciones parseadas, base de
 * asilo = opinión política + grupo social, fechas coherentes. node docs/_evidence/i589-fill-real-case.mjs */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const supa = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const FORM_DEF = "e7f12a89-d1dd-4478-84f3-17afff5a0b8d";
const RESPONSE_ID = "8ba801ac-8897-406c-a159-63743861fef9";

const { data: ver } = await supa.from("form_automation_versions").select("id").eq("form_definition_id", FORM_DEF).eq("status", "published").single();
const { data: groups } = await supa.from("form_question_groups").select("id,title_i18n,position").eq("automation_version_id", ver.id);
const gById = new Map(groups.map((g) => [g.id, g]));
const { data: qs } = await supa.from("form_questions").select("*").in("group_id", groups.map((g) => g.id)).order("position");
const { data: resp } = await supa.from("case_form_responses").select("answers").eq("id", RESPONSE_ID).single();
const cur = resp.answers || {};

// Narrativas (inglés, distintas por pregunta) --------------------------------
const PAST_HARM =
  "I am an investigative journalist. From 2012 until I fled in 2025, I worked as a staff reporter for the newspaper El Nacional in Caracas, where I investigated and published articles exposing embezzlement of public funds by regional officials linked to the ruling party. Beginning in early 2024, after a series of my articles was published, I received repeated anonymous death threats by phone and text message ordering me to stop reporting. In September 2024, while I was away, armed men believed to be SEBIN (intelligence police) agents raided my home, ransacked my office, and warned my family that I would 'disappear' if I continued. In June 2025, a contact inside the security services warned me that an order had been issued for my arrest. I believe I was targeted because of my journalism and my political opinion opposing government corruption.";
const FUTURE_FEAR =
  "If I return to Venezuela, I fear I would be arbitrarily detained, imprisoned on fabricated charges, tortured, or killed by SEBIN or pro-government armed groups (colectivos) because of my journalism exposing government corruption. Several colleagues who reported on the same officials have been jailed or have disappeared. The government controls the police and the courts, so I would have no effective protection anywhere in the country. My name remains associated with reporting the authorities consider hostile to the state.";
const ORG_MEMBERSHIP =
  "I worked as a staff investigative reporter for the newspaper El Nacional in Caracas from March 2012 until I fled in 2025. I was also a member of the National Union of Press Workers (SNTP), a journalists' association. My role was senior investigative reporter; I held no leadership or political-party position.";

// Override explícito por question id (Part A.I fixes + Part B/C + base de asilo) ---
const OVERRIDE = {
  // Part A.I
  "8aba75b3-b725-4337-86d0-b30d30e479f1": "Pérez",                 // last name (limpiar "-Test")
  "e8538520-6064-48b2-8b46-0f4051f85b48": "female",                // SEX → Femenino
  "6c765d1f-9561-467c-a851-ab9cf32cc9d8": "Caracas, Venezuela",    // city+country of birth
  "f06be1a4-2523-4187-acf5-17d3d66b3d8f": "8425 NW 53rd Street",   // US residence street
  "52b97ada-d149-47f9-afb2-6313f7ef1c8b": "Doral",                 // US city
  "8fcdec79-5dd0-4e5d-bfc3-ef2bd8f3e3dd": "FL",                    // US state
  "7ba0cc4d-1feb-40c2-a7a4-0b557554d3a4": "33166",                 // ZIP
  "e489e562-eb31-4adb-bbc1-a735e7b10a4f": "305",                   // area code
  "f56dc7bd-3882-4f4b-9477-ad86bf4831d7": "555-0142",              // phone
  "53b6a47a-b8de-4b81-b2d7-69a2a8f8acdf": "12",                    // apt number
  "27ce6f23-4c33-472f-bf95-5842fab37f22": "no",                    // ever before immigration judge → No (affirmative)
  "bb2a7d9c-4de0-4ed6-a5c2-d64a0e012bd1": "Venezuelan",            // nationality at birth
  "46d50fb4-41c5-4b46-8f97-83a50a953ef8": "2025-08-15",            // last left country
  "81ee8895-e5d2-4938-ad80-658b70f08193": "99887766554",          // I-94
  "a677507b-4590-4781-a542-d44f0755c481": "2025-08-15",            // last entry date
  "86c3fadb-8ce9-489d-9cbd-91bd247ebb65": "Miami International Airport, Miami, FL", // last entry place
  "1e6dfe6c-a593-4b93-a191-7124ad99977d": "Parole",               // status at entry
  "32f4d696-e7a7-4536-9360-7ebaf1cec01a": "2027-08-14",           // status expires
  "1990b40b-f85f-4aaa-a031-f67a41da9945": "Venezuela",            // country issued passport
  "ce539ebd-0dc2-47eb-8cb5-a7edd0bd5c01": "P12345678",            // passport number
  "0c3996b6-2667-4e2c-9fdd-d9d8e103e689": "2028-06-30",           // passport expiration
  "5828191c-7212-4865-b75a-d26bce909cc5": "Spanish",             // native language
  "d169d763-1fce-4986-bc90-9bc69224ef17": "no",                  // fluent English
  // Part B — base de asilo: SOLO opinión política + grupo social
  "2ebd0587-347b-4c5f-9fe2-75ce08be5e3e": ["political_opinion", "social_group"],
  "78576419-1720-4ce9-be05-3577002a2088": "si",                  // A: past harm/threats
  "f8d04f73-0a30-41de-a1b1-a495c9b02f44": PAST_HARM,
  "11003670-e979-46c1-ae01-5715dd2012da": "si",                  // B: fear future harm
  "5e6240af-30b2-47b5-9d8a-c6debf6aa4ce": FUTURE_FEAR,
  "350026e7-87e7-4d1f-b8de-dccca7d392e8": "no",                  // arrested/detained abroad → No (fled before arrest)
  "58056358-00c8-4c49-8f0c-317b1138176d": "",
  "2bf9850e-f555-4180-8101-1ea9c9e28a2d": "si",                  // belonged to org (press) → Yes
  "c03261e8-4eb2-44f9-a602-9959676ce6ae": ORG_MEMBERSHIP,
  "3e75deeb-8dba-439d-977c-1051c9e46e8b": "no",                  // still participate → No
  "3cc39428-1251-4977-98f5-01d79a6e8d72": "",
  "e79ea597-aecc-4d1d-97a1-13572515205a": "no",                  // afraid of torture (CAT) → No (asylum-only)
  "2c5083bd-20d8-40d4-83cb-18676374ecb9": "",
  // Part C — TODAS las barreras en No + explicaciones vacías (condicionales ocultas)
  "1c0d09da-e674-4c03-8264-e4227a4c7077": "no",                  // previous asylum
  "56c0e105-1501-4c8b-b396-cd8d58fa7d8e": "",
  "2cc71ba1-b341-4492-b676-dff7f610c4b8": "no",                  // transit third country (flew direct)
  "3a243f1f-870f-4676-9ccd-f6aba4682d86": "no",                  // lawful status other country
  "a392bce2-e673-4ccd-8133-c37a0998e49e": "",
  "dd4145c3-2a4e-4bc9-af39-c98856f359df": "no",                  // PERSECUTOR bar → No
  "f6b557e5-3149-4dd8-9f3e-2adc1ac846a4": "",
  "b8fdbbff-70c9-4345-b3d0-3dd8cd67c6d7": "no",                  // returned to country → No
  "6a8eba32-2b39-40e9-8f05-039e2dfe06d8": "",
  "c89582cb-6014-4a87-8180-82b1596562d6": "no",                  // filing >1yr after arrival → No (arrived 2025)
  "93b15b3e-2c98-4618-be73-37c312ec93c7": "",
  "5e7423e3-5b59-4cae-b494-270d802bb9ae": "no",                  // crime/arrest in US → No
  "6bc3cbcc-a701-479b-9690-adf5158266ed": "",
};

const CHILD = {
  first: ["Mateo", "Sofía", "Diego", "Valentina"],
  dob: ["2012-04-10", "2014-08-22", "2017-01-15", "2019-11-03"],
  sex: ["male", "female", "male", "female"],
  i94: ["99887766501", "99887766502", "99887766503", "99887766504"],
};

// Valor por etiqueta (inglés) para hijos, cónyuge, Part A.III, Part D ----------
function byLabel(q) {
  const es = q.question_i18n?.es || "";
  const en = q.question_i18n?.en || "";
  const L = (es + " ¦ " + en).toLowerCase();
  const opts = Array.isArray(q.options) ? q.options : null;
  const yn = opts && opts.some((o) => o.value === "si") && opts.some((o) => o.value === "no");
  const has = (...w) => w.some((x) => L.includes(x));

  // ---- HIJOS (Child N) ----
  const cm = /hijo\s*(\d+)/i.exec(es);
  if (cm) {
    const i = Number(cm[1]) - 1;
    if (has("apellido", "last name")) return "Martínez Pérez";
    if (has("segundo nombre", "middle")) return "A.";
    if (has("nombre", "first name")) return CHILD.first[i];
    if (q.field_type === "date" && has("nacimiento", "birth")) return CHILD.dob[i];
    if (has("sexo", "sex")) return CHILD.sex[i];
    if (has("nacionalidad", "nationality", "citizenship")) return "Venezuelan";
    if (has("raza", "race", "étnic", "ethnic")) return "Hispanic/Latino";
    if (has("ciudad y país", "city and country")) return "Caracas, Venezuela";
    if (has("estado civil", "marital")) return "Single";
    if (has("a-number", "registro de extranjero")) return "";           // → N/A
    if (has("pasaporte", "passport")) return "";                         // → N/A
    if (has("seguro social", "social security", "ssn")) return "";       // → N/A
    if (has("¿está actualmente", "is this child in the u")) return "si"; // in US
    if (has("lugar de la última entrada", "place of last entry")) return "Miami International Airport, Miami, FL";
    if (q.field_type === "date" && has("última entrada", "last entry")) return "2025-08-15";
    if (has("i-94", "i94")) return CHILD.i94[i];
    if (has("estatus al ser admitido", "status when last admitted")) return "Parole";
    if (has("estatus migratorio actual", "current status")) return "Parole";
    if (q.field_type === "date" && has("vencimiento", "expiration")) return "2027-08-14";
    if (has("corte de inmigración", "immigration court")) return "no";
    if (has("incluir", "include")) return "si";
    return undefined;
  }

  // ---- CÓNYUGE ---- (solo preguntas SOBRE el cónyuge, no cualquier mención — p.ej. NO
  // "¿Te ayudó alguien que no es tu cónyuge...?" ni "relación (ej. hijo, cónyuge)")
  if (/^\s*(cónyuge|conyuge)\b/i.test(es) || has("de su cónyuge", "de tu cónyuge", "del cónyuge", "your spouse", "spouse —", "spouse -")) {
    if (has("apellido", "last name")) return "Martínez";
    if (has("segundo nombre", "middle")) return "José";
    if (has("nombre", "first name")) return "Roberto";
    if (q.field_type === "date" && has("nacimiento", "date of birth")) return "1985-03-22";
    if (has("sexo", "sex")) return "male";
    if (has("a-number", "registro de extranjero")) return "A123456790";
    if (has("pasaporte", "passport")) return "P87654321";
    if (has("seguro social", "social security", "ssn")) return "";       // → N/A
    if (has("otros nombres", "other names")) return "";                  // → N/A
    if (q.field_type === "date" && has("matrimonio", "marriage")) return "2010-06-20";
    if (has("lugar de matrimonio", "place of marriage")) return "Caracas, Venezuela";
    if (has("ciudad y país de nacimiento", "city and country of birth")) return "Maracaibo, Venezuela";
    if (has("nacionalidad", "nationality", "citizenship")) return "Venezuelan";
    if (has("raza", "race", "étnic", "ethnic")) return "Hispanic/Latino";
    if (has("¿está esta persona", "is this person in the u", "actualmente en los estados unidos")) return "si";
    if (has("lugar de la última entrada", "place of last entry")) return "Miami International Airport, Miami, FL";
    if (q.field_type === "date" && has("última entrada", "last entry")) return "2025-08-15";
    if (has("i-94", "i94")) return "99887766550";
    if (has("estatus al ser admitido", "status when last admitted")) return "Parole";
    if (has("estatus migratorio actual", "current status")) return "Humanitarian parole";
    if (q.field_type === "date" && has("vencimiento", "expiration")) return "2027-08-14";
    if (has("corte de inmigración", "immigration court")) return "no";
    if (q.field_type === "date" && has("llegada anterior", "previous arrival")) return "";  // → N/A
    if (has("incluir", "include")) return "si";
    return undefined;
  }

  // ---- PART A.III: direcciones (parseadas), educación, empleo, familia ----
  // Última dirección fuera de EE.UU. / en el país de persecución (Venezuela)
  if (has("última dirección", "last address")) {
    if (has("número y calle", "street")) return "Av. Andrés Bello, Res. El Bosque, Torre A, Apt 5-B";
    if (has("ciudad", "city")) return "Caracas";
    if (has("departamento", "provincia", "estado", "province", "state")) return "Distrito Capital";
    if (has("país", "country")) return "Venezuela";
    if (q.field_type === "date" && has("desde", "from")) return "2015-06-01";
    if (q.field_type === "date" && has("hasta", "to")) return "2025-08-01";
    return undefined;
  }
  // Residencias últimos 5 años
  const rm = /residencia\s*(\d+)/i.exec(es);
  if (rm) {
    const i = Number(rm[1]);
    if (i === 1) { // actual: Doral, USA
      if (has("número y calle", "street")) return "8425 NW 53rd Street, Apt 12";
      if (has("ciudad", "city")) return "Doral";
      if (has("departamento", "provincia", "estado", "province", "state")) return "FL";
      if (has("país", "country")) return "USA";
      if (q.field_type === "date" && has("desde", "from")) return "2025-08-01";
      if (q.field_type === "date" && has("hasta", "to")) return "2026-06-01";
      return undefined;
    }
    if (i === 2) { // anterior: Caracas
      if (has("número y calle", "street")) return "Av. Andrés Bello, Res. El Bosque, Torre A, Apt 5-B";
      if (has("ciudad", "city")) return "Caracas";
      if (has("departamento", "provincia", "estado", "province", "state")) return "Distrito Capital";
      if (has("país", "country")) return "Venezuela";
      if (q.field_type === "date" && has("desde", "from")) return "2015-06-01";
      if (q.field_type === "date" && has("hasta", "to")) return "2025-08-01";
      return undefined;
    }
    return ""; // residencias 3-5 → N/A
  }
  // Educación
  const em = /educación\s*(\d+)/i.exec(es);
  if (em) {
    const i = Number(em[1]);
    if (i === 1) {
      if (has("institución", "institution", "nombre de la escuela", "school name")) return "Universidad Central de Venezuela";
      if (has("tipo", "type")) return "University";
      if (has("ubicación", "location")) return "Caracas, Venezuela";
      if (q.field_type === "date" && has("desde", "from")) return "2006-09-01";
      if (q.field_type === "date" && has("hasta", "to")) return "2011-07-01";
      return undefined;
    }
    if (i === 2) {
      if (has("institución", "institution", "school name")) return "Colegio San Ignacio de Loyola";
      if (has("tipo", "type")) return "High School";
      if (has("ubicación", "location")) return "Caracas, Venezuela";
      if (q.field_type === "date" && has("desde", "from")) return "2000-09-01";
      if (q.field_type === "date" && has("hasta", "to")) return "2006-06-01";
      return undefined;
    }
    return ""; // educación 3-4 → N/A
  }
  // Empleo
  const wm = /empleo\s*(\d+)/i.exec(es);
  if (wm) {
    const i = Number(wm[1]);
    if (i === 1) {
      if (has("empleador", "employer")) return "El Nacional (newspaper), Caracas, Venezuela";
      if (has("ocupación", "occupation")) return "Journalist";
      if (q.field_type === "date" && has("desde", "from")) return "2012-03-01";
      if (q.field_type === "date" && has("hasta", "to")) return "2025-08-01";
      return undefined;
    }
    if (i === 2) {
      if (has("empleador", "employer")) return "Últimas Noticias (newspaper), Caracas, Venezuela";
      if (has("ocupación", "occupation")) return "Reporter";
      if (q.field_type === "date" && has("desde", "from")) return "2011-08-01";
      if (q.field_type === "date" && has("hasta", "to")) return "2012-02-01";
      return undefined;
    }
    return ""; // empleo 3 → N/A
  }
  // Padres / hermanos: NO fallecidos, con ubicación actual coherente
  if (has("madre", "mother")) {
    if (has("fallecid", "deceased")) return false;
    if (has("nombre completo", "full name")) return "Ana María Gómez de Pérez";
    if (has("ciudad y país de nacimiento", "city and country of birth")) return "Valencia, Venezuela";
    if (has("ubicación actual", "current location")) return "Caracas, Venezuela";
    return undefined;
  }
  if (has("padre", "father")) {
    if (has("fallecid", "deceased")) return false;
    if (has("nombre completo", "full name")) return "José Antonio Pérez";
    if (has("ciudad y país de nacimiento", "city and country of birth")) return "Caracas, Venezuela";
    if (has("ubicación actual", "current location")) return "Caracas, Venezuela";
    return undefined;
  }
  const sm = /hermano\/a\s*(\d+)|hermano\s*(\d+)|sibling\s*(\d+)/i.exec(L);
  if (sm) {
    const i = Number(sm[1] || sm[2] || sm[3]);
    if (has("fallecid", "deceased")) return false;
    if (i === 1) {
      if (has("nombre completo", "full name")) return "Luis Alberto Pérez";
      if (has("nacimiento", "birth")) return "Caracas, Venezuela";
      if (has("ubicación actual", "current location")) return "Caracas, Venezuela";
      return undefined;
    }
    if (i === 2) {
      if (has("nombre completo", "full name")) return "Carmen Rosa Pérez";
      if (has("nacimiento", "birth")) return "Caracas, Venezuela";
      if (has("ubicación actual", "current location")) return "Bogotá, Colombia";
      return undefined;
    }
    return ""; // hermanos 3-4 → N/A
  }

  // ---- PART D: personas adicionales + preparador ----
  if (has("primera persona adicional", "first additional person")) return "Mateo A. Martínez Pérez";
  if (has("relación tiene esa persona", "relationship")) {
    if (has("segunda", "second")) return "Daughter";
    return "Son";
  }
  if (has("segunda persona adicional", "second additional person")) return "Sofía A. Martínez Pérez";
  if (has("¿te ayudó alguien", "did anyone", "help you complete")) return "no"; // sin preparador externo

  return undefined; // no match → conservar valor actual
}

// Ensamblar answers -----------------------------------------------------------
const answers = { ...cur };
let changed = 0;
for (const q of qs) {
  let v = OVERRIDE[q.id];
  if (v === undefined) v = byLabel(q);
  if (v === undefined) continue; // conservar
  answers[q.id] = v;
  changed++;
}

const { error } = await supa.from("case_form_responses").update({ answers, translation_status: "none" }).eq("id", RESPONSE_ID);
if (error) { console.error("UPDATE_FAIL", error.message); process.exit(2); }
console.log(`OK — ${changed} respuestas actualizadas de ${qs.length} preguntas.`);
