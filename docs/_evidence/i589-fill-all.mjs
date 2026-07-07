/* Rellena TODAS las preguntas del I-589 con datos irreales pero trazables (persona
 * maximal: casada, 6 hijos, todos los "Sí", en corte, con preparador) para verificar
 * que cada campo autocompleta donde debe. node docs/_evidence/i589-fill-all.mjs */
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
const { data: qs } = await supa.from("form_questions").select("*").in("group_id", groups.map((g) => g.id));

const en = (q) => String(q.question_i18n?.en || "").trim();
// valor realista por palabra clave; si no, la etiqueta (truncada) para poder TRAZAR el campo.
function genText(q) {
  const l = en(q).toLowerCase();
  const pick = (...pairs) => { for (const [re, v] of pairs) if (re.test(l)) return v; return null; };
  const v = pick(
    [/last name|apellido/, "Perez-Test"],
    [/first name/, "Karelis"],
    [/middle name/, "Andreina"],
    [/other names|maiden|alias/, "K. Perez"],
    [/a-?number|alien registration/, "A123456789"],
    [/social security|ssn/, "123-45-6789"],
    [/passport|i-94|i94/, "P987654321"],
    [/occupation|employer|trabajo|empleo/, "Periodista — Diario El Nacional"],
    [/street|address|direcci/, "Av. Libertador 123, Chacao"],
    [/city|ciudad/, "Caracas"],
    [/country|pais|país/, "Venezuela"],
    [/state|estado/, "FL"],
    [/zip|postal/, "33134"],
    [/without area code|sin código de área/, "555-1234"],
    [/area code|código de área/, "305"],
    [/telephone|phone|tele/, "555-1234"],
    [/school|education|universi|colegio/, "Universidad Central de Venezuela"],
    [/relationship|parentesco/, "Hijo/a"],
    [/name of.*person|person.*name|nombre/, "Jose Miguel Perez"],
    [/status|estatus/, "Parole humanitario"],
    [/native alphabet/, "Karelis Perez"],
    [/complete name/, "Karelis Andreina Perez-Test"],
    [/explain|describe|why|detail|narrativ|circumstanc/, "Por mi labor periodística denuncié corrupción; recibí amenazas de muerte y un allanamiento. Temo ser encarcelada o asesinada si regreso."],
  );
  if (v) return v;
  // fallback trazable: la etiqueta del campo (para ver en qué casilla del PDF cae).
  return "«" + en(q).slice(0, 38) + "»";
}

const answers = {};
let n = { text: 0, date: 0, number: 0, select: 0, multiselect: 0, checkbox: 0 };
for (const q of qs) {
  const opts = Array.isArray(q.options) ? q.options : null;
  const isYesNo = opts && opts.length === 2 && opts.some((o) => o.value === "si") && opts.some((o) => o.value === "no");
  const l = en(q).toLowerCase();
  switch (q.field_type) {
    case "multiselect": answers[q.id] = opts ? opts.map((o) => o.value) : []; n.multiselect++; break;
    case "checkbox": answers[q.id] = true; n.checkbox++; break;
    case "number": answers[q.id] = /child|hij|how many/.test(l) ? "6" : "2"; n.number++; break;
    case "date":
      answers[q.id] = /sign|firma/.test(l) ? "" // firma en blanco por diseño
        : /birth|born|nacim/.test(l) ? "1988-05-14"
        : /marriage|matrim/.test(l) ? "2010-06-20"
        : /entry|arriv|admitted|last entry/.test(l) ? "2024-01-15"
        : "2015-03-10";
      n.date++; break;
    case "select":
      if (isYesNo) answers[q.id] = "si";
      else if (/marital/.test(l)) answers[q.id] = "married";
      else if (/immigration judge|court|proceeding/.test(l)) answers[q.id] = (opts.find((o) => /ongoing|yes/i.test(o.value)) || opts[0]).value;
      else answers[q.id] = opts && opts.length ? opts[0].value : "";
      n.select++; break;
    default: answers[q.id] = genText(q); n.text++;
  }
}

// Overrides para asegurar que TODOS los bloques condicionales se muestren.
for (const q of qs) {
  const l = en(q).toLowerCase();
  if (/are you currently married/.test(l)) answers[q.id] = "si";
  if (/do you have.*children/.test(l)) answers[q.id] = "si";
  if (/how many children/.test(l)) answers[q.id] = "6";
  if (/legal marital status/.test(l)) answers[q.id] = "married";
}

const { error } = await supa.from("case_form_responses").update({ answers, translation_status: "none" }).eq("id", RESPONSE_ID);
if (error) { console.error("UPDATE_FAIL", error.message); process.exit(2); }
console.log(`OK — ${qs.length} preguntas rellenadas:`, n);
