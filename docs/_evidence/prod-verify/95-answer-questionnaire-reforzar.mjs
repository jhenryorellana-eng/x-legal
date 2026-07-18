/* Fase 2.2 — Answer the reforzar questionnaire (fake, coherent, Yenifer/MS-13). */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const supa = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const ids = JSON.parse(fs.readFileSync(path.join(__dirname, "reforzar-ids.json"), "utf8"));
const q = JSON.parse(fs.readFileSync(path.join(__dirname, "reforzar-questionnaire.json"), "utf8"));
const Q_FORM = "65185b35-8129-4c92-98dd-a89871229c62";
const PHASE = "53160171-81b5-472c-ac55-f73c6c095228";

const ANSWERS = [
  "La MS-13 me contactó a través de dos jóvenes del barrio que actuaban como 'banderas' (vigías) de la pandilla; llegaban a la tienda cada viernes a cobrar los $200 en efectivo. Nunca me dieron un nombre real, solo apodos.",
  "Para junio de 2023 la 'renta' había subido a $350 semanales, y me advirtieron que pronto sería más. Con las ventas de la tienda era imposible pagar esa cantidad sin quebrar.",
  "Durante esos meses no me golpearon físicamente, pero sí sufrí amenazas constantes y un día rompieron la vitrina de la tienda como advertencia cuando pagué tarde.",
  "Antes de denunciar hablé con mi madre y con un vecino de confianza. Me advirtieron que denunciar era peligroso, pero decidí hacerlo porque ya no podía pagar y temía por mi familia.",
  "La denuncia la tomó un agente de la PNC en la Delegación de San Miguel; me pidió describir a los cobradores pero me dijo que era difícil actuar porque la zona estaba 'controlada'. No me ofrecieron protección.",
  "Creo que se enteraron porque en el barrio la pandilla tiene informantes, y pocos días después de la denuncia uno de los cobradores me dijo 'sabemos que fuiste a poner el dedo'. Nadie más sabía que yo había denunciado.",
  "Sí, tras el asesinato de mi hermano volví a la PNC, pero solo tomaron nota. Dijeron que investigarían, aunque nunca hubo detenidos ni seguimiento real.",
  "El registro de la PNC indica que Kevin, de 19 años, murió por disparos de dos sujetos en motocicleta frente a nuestra casa el 12 de septiembre de 2023. La investigación quedó sin imputados.",
  "Hubo al menos dos vecinos que escucharon los disparos y vieron la motocicleta huir, pero por miedo a represalias no quisieron declarar ante la policía.",
  "El asesinato nos destrozó. Mi madre cayó en depresión y yo desarrollé insomnio y ataques de pánico. En Miami he empezado a recibir apoyo psicológico por el trauma.",
  "La nota apareció dentro de la tienda, deslizada bajo la reja, alrededor del 1 de octubre de 2023. Estaba escrita a mano y decía que ya sabía lo que le pasó a mi hermano y que 'seguía' si no pagaba o hablaba con la policía.",
  "'El Duke' me abordó a fines de septiembre de 2023 cuando cerraba la tienda; me dijo de frente que el asesinato de mi hermano había sido 'un mensaje' y que la próxima sería yo. Lo reconocí porque controlaba el sector.",
  "También recibí llamadas de números desconocidos y un par de mensajes de texto en esas semanas, siempre exigiendo el pago y advirtiéndome que no acudiera a la policía.",
  "Me escondí en casa de una tía en Usulután durante unos tres meses, de octubre a diciembre de 2023. Aun así temía que la pandilla, con presencia en todo el país, me localizara.",
  "Sí, consideré acudir a la Fiscalía, pero varios conocidos me advirtieron que las pandillas tienen informantes incluso dentro de las instituciones y que denunciar de nuevo solo aumentaría el riesgo. No confiaba en obtener protección real.",
  "Salí de El Salvador en enero de 2024 por vía terrestre, cruzando Guatemala y México con ayuda de un guía, hasta llegar a la frontera de Estados Unidos, donde solicité asilo.",
  "Sí. Mi madre me contó que, meses después de mi salida, sujetos preguntaron por mí en el barrio y advirtieron que 'me estaban esperando'. Eso confirma que la MS-13 sigue buscándome.",
  "Aunque el 'Régimen de Excepción' redujo algunos homicidios, las pandillas siguen operando y tomando represalias, y quienes denunciaron saben que la protección estatal es limitada. No me siento segura de regresar.",
];

const qList = q.schema.groups.flatMap((g) => g.questions);
if (qList.length !== ANSWERS.length) { console.error(`MISMATCH: ${qList.length} vs ${ANSWERS.length}`); process.exit(2); }
const answers = {};
qList.forEach((qq, i) => { answers[qq.id] = ANSWERS[i]; });

const { data: existing } = await supa.from("case_form_responses").select("id").eq("case_id", ids.caseId).eq("form_definition_id", Q_FORM).is("party_id", null).maybeSingle();
const row = { case_id: ids.caseId, form_definition_id: Q_FORM, party_id: null, service_phase_id: PHASE, questionnaire_instance_id: q.instanceId, answers, status: "approved", submitted_at: new Date().toISOString(), reviewed_by: "00000000-0000-0000-0000-000000000003", reviewed_at: new Date().toISOString() };
let respId;
if (existing) { await supa.from("case_form_responses").update(row).eq("id", existing.id); respId = existing.id; }
else { const { data, error } = await supa.from("case_form_responses").insert(row).select("id").single(); if (error) { console.error("FAIL", error.message); process.exit(3); } respId = data.id; }
console.log(`OK — reforzar questionnaire answered (${ANSWERS.length}) response=${respId} instance=${q.instanceId}`);
