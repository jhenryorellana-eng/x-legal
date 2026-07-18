/* Fase 2.1 — Answer the 18-question dynamic questionnaire (fake but coherent, matches the
 * Karelis narrative) so the memo consumes it. Creates a case_form_responses for the
 * questionnaire form, keyed by the schema question IDs, linked to the instance.
 * Run: node docs/_evidence/prod-verify/55-answer-questionnaire-asilo.mjs */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const supa = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const ids = JSON.parse(fs.readFileSync(path.join(__dirname, "asilo-ids.json"), "utf8"));
const q = JSON.parse(fs.readFileSync(path.join(__dirname, "asilo-questionnaire.json"), "utf8"));
const Q_FORM = "138f4f0e-88fb-4694-baa0-2981964d8bfc";
const PHASE = "10218501-fde6-488a-a11a-8b9ed4c41fc6";

const ANSWERS = [
  "Publiqué aproximadamente 14 reportajes entre marzo de 2023 y enero de 2024, todos en El Nacional y su plataforma digital. Los principales fueron 'Los contratos fantasma de la salud' (mayo 2023), 'Hospitales sin insumos, cuentas millonarias' (agosto 2023) y 'La red de sobreprecios en el estado Miranda' (noviembre 2023).",
  "Las investigaciones implicaban a directores regionales de salud del estado Miranda y a un secretario de gobierno vinculado al partido de gobierno, además de dos empresas contratistas ('Suministros Andinos C.A.' y 'Distribuidora Hospitalaria del Centro'). Por seguridad no revelé todos los nombres, pero varios funcionarios fueron identificados por cargo.",
  "Tras las publicaciones, un vocero del gobierno regional calificó los reportajes de 'guerra mediática' y 'terrorismo informativo' en una rueda de prensa, y El Nacional recibió una citación de la fiscalía. Los directivos me pidieron 'bajar el perfil', pero no me presionaron para callar.",
  "Entre el 18 de febrero y el 12 de septiembre de 2024 recibí unas 9 amenazas: 5 mensajes de texto, 2 llamadas y 2 mensajes de WhatsApp, desde números distintos que luego quedaban fuera de servicio. El contenido repetía que dejara de 'atacar a la revolución' y advertía consecuencias para mí y mi familia.",
  "Sí. En un mensaje de abril de 2024 mencionaron el nombre de mi hijo y la escuela a la que asistía, lo que me hizo entender que me vigilaban. Nunca dieron mi dirección textual, pero sí datos que solo alguien que me seguía podía conocer.",
  "Sí, después del allanamiento las amenazas se volvieron más directas: recibí 3 llamadas más entre octubre de 2024 y mayo de 2025 diciendo que 'la próxima vez no habría advertencia'. El tono cambió de intimidación a amenaza inminente de detención.",
  "Entraron cinco hombres, cuatro vestidos de civil y uno con chaleco táctico sin insignias, con los rostros parcialmente cubiertos. No mostraron orden judicial. Uno se identificó verbalmente como 'del Estado' y dirigía a los demás; ninguno dio su nombre. Llegaron en dos camionetas sin placas visibles.",
  "Estaban presentes mi madre, que me visitaba esa semana, y una vecina que tocó la puerta al escuchar ruido y fue apartada bruscamente. El portero del edificio vio salir a los hombres con mi computadora y podría ser testigo.",
  "Me sujetaron con fuerza del antebrazo derecho y me empujaron contra la pared cuando intenté impedir que se llevaran mis archivos, lo que causó los hematomas del informe médico. No hubo golpes adicionales, pero quedé con una crisis de ansiedad severa.",
  "El CICPC recibió la denuncia pero nunca inició diligencias reales. Volví dos veces a preguntar y me dijeron que 'estaba en trámite'; nunca citaron testigos ni dieron resultado. Es el patrón habitual cuando el señalado es el propio aparato de seguridad.",
  "El contacto era un funcionario de rango medio de un cuerpo de seguridad, a quien identifico con el seudónimo 'R.' para protegerlo. Me avisó en persona a mediados de junio de 2025 que existía una orden por 'instigación al odio' y 'traición a la patria'; describió un número de expediente pero no pude fotografiarlo.",
  "Dejé de trabajar públicamente, me mudé temporalmente a casa de una tía, cambié de número de teléfono y evité mis rutas habituales. Aun así, en julio noté un vehículo estacionado frente a la casa de mis padres durante varios días.",
  "Salí de Venezuela el 15 de agosto de 2025 por el Aeropuerto Internacional de Maiquetía con mi pasaporte venezolano real. En migración me interrogaron brevemente y revisaron mi teléfono, pero finalmente me dejaron abordar; temí ser detenida en ese momento.",
  "Puedo mencionar a dos colegas: 'J.M.', reportero detenido en 2023 y liberado tras meses (documentado por el SNTP), y 'A.R.', corresponsal que desapareció por semanas en 2024 y luego se exilió. Sus casos aparecen en informes del SNTP y de la CPJ.",
  "El colega que firmó la Evidencia E prefiere el anonimato por seguridad, pues sigue en Venezuela. Un exeditor de El Nacional radicado en España sí estaría dispuesto a firmar una carta con su nombre completo, al igual que un representante del SNTP.",
  "Sí. En septiembre de 2025, dos personas no identificadas preguntaron por mí en el edificio de mis padres y les advirtieron que 'me convenía no seguir hablando desde afuera'. Mis padres no denunciaron por miedo a represalias.",
  "Sí, desde mi llegada he publicado dos columnas en un medio digital en el exilio y he dado una entrevista sobre libertad de prensa. Tras la segunda publicación, una cuenta afín al gobierno me mencionó en redes calificándome de 'traidora al servicio del imperio'.",
  "La persecución me dejó ansiedad crónica e insomnio; asisto a terapia psicológica en Miami desde octubre de 2025. Mi hijo mayor también muestra signos de estrés. La psicóloga que me atiende estaría dispuesta a emitir un informe clínico para el expediente.",
];

const qList = q.schema.groups.flatMap((g) => g.questions);
if (qList.length !== ANSWERS.length) { console.error(`MISMATCH: ${qList.length} questions vs ${ANSWERS.length} answers`); process.exit(2); }
const answers = {};
qList.forEach((qq, i) => { answers[qq.id] = ANSWERS[i]; });

const { data: existing } = await supa.from("case_form_responses").select("id").eq("case_id", ids.caseId).eq("form_definition_id", Q_FORM).is("party_id", null).maybeSingle();
const row = {
  case_id: ids.caseId, form_definition_id: Q_FORM, party_id: null, service_phase_id: PHASE,
  questionnaire_instance_id: q.instanceId, answers, status: "approved",
  submitted_at: new Date().toISOString(), reviewed_by: "00000000-0000-0000-0000-000000000003", reviewed_at: new Date().toISOString(),
};
let respId;
if (existing) { await supa.from("case_form_responses").update(row).eq("id", existing.id); respId = existing.id; }
else { const { data, error } = await supa.from("case_form_responses").insert(row).select("id").single(); if (error) { console.error("FAIL", error.message); process.exit(3); } respId = data.id; }
console.log(`OK — questionnaire answered (${ANSWERS.length} answers) response=${respId} instance=${q.instanceId}`);
