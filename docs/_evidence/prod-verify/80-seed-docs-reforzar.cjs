/* Fase 2.2 — Seed reforzar-asilo input documents (fake, coherent): Declaración jurada
 * (affidavit) + Evidencias sustentatorias + Formulario I-589 completo (ya presentado),
 * each with a deterministic completed document_extraction. Persona: Yenifer (El Salvador,
 * MS-13). Run: node docs/_evidence/prod-verify/80-seed-docs-reforzar.cjs */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));
const { PDFDocument, StandardFonts, rgb } = require(path.join(__dirname, "../../../node_modules/pdf-lib"));

const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const envGet = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null; };
const URL = envGet("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE = envGet("SUPABASE_SERVICE_ROLE_KEY");
const ids = JSON.parse(fs.readFileSync(path.join(__dirname, "reforzar-ids.json"), "utf8"));

const CASE_ID = ids.caseId;
const PHASE_ID = "53160171-81b5-472c-ac55-f73c6c095228"; // reforzar fase-1
const UPLOADED_BY = ids.clientId;
const TYPE_DECLARACION = "5a28333b-e07d-45a2-83a2-7398ab411814"; // declaracion-jurada-affidavit
const TYPE_EVIDENCIAS = "5b5bdd7d-9226-417f-a775-10988b009c86"; // evidencias-sustentatorias
const TYPE_I589 = "cce0763a-2bd7-420d-b5b1-1bb5dd05605d"; // formulario-i-589-completo-con-anexos
const BUCKET = "case-documents";
const EXTRACTION_MODEL = "gemini-2.5-flash";

const AFFIDAVIT = {
  title: "DECLARACION JURADA",
  paras: [
    "Yo, Yenifer del Carmen Rodriguez Alvarado, mayor de edad, de nacionalidad salvadorena, nacida en San Miguel, El Salvador, el 3 de marzo de 1992, titular del pasaporte salvadoreno No. S9988776, actualmente residenciada en 1490 SW 8th Street, Apt 3, Miami, Florida 33135, declaro bajo juramento y so pena de perjurio lo siguiente:",
    "1. IDENTIDAD Y ACTIVIDAD. Antes de huir era propietaria de una pequena tienda de abarrotes en el barrio San Francisco, en la ciudad de San Miguel. Vivia con mi madre y mi hermano menor. Ya presente mi solicitud de asilo (Formulario I-589) ante USCIS y este procedimiento busca reforzar mi caso con la declaracion y las evidencias que antes no pude reunir.",
    "2. EXTORSION DE LA MS-13. A partir de marzo de 2023, miembros de la pandilla Mara Salvatrucha (MS-13) que controlaban el barrio comenzaron a exigirme el pago de 'renta' (extorsion) de 200 dolares semanales bajo amenaza de muerte. Al principio pague por miedo, pero el monto siguio subiendo hasta hacerse imposible.",
    "3. NEGATIVA Y DENUNCIA. En julio de 2023 me negue a seguir pagando y presente una denuncia ante la Policia Nacional Civil (PNC). La pandilla se entero de la denuncia, presumiblemente por sus contactos, y me senalo como 'oreja' (informante), lo que en la logica de la pandilla equivale a una sentencia de muerte.",
    "4. ASESINATO DE MI HERMANO. El 12 de septiembre de 2023, mi hermano menor, Kevin Alexander Rodriguez, de 19 anos, fue asesinado a tiros frente a nuestra casa por dos sujetos en motocicleta. La PNC registro el homicidio (Evidencia B). Entendi que fue una represalia directa por mi negativa y mi denuncia.",
    "5. AMENAZAS DIRECTAS. Tras el asesinato, recibi mensajes y notas dejadas en la tienda advirtiendome que yo 'seguia' si no pagaba o si hablaba con la policia. Un lider local de la MS-13 conocido como 'el Duke' me lo dijo personalmente. Cerre la tienda y me escondi en casa de una tia en otra ciudad.",
    "6. HUIDA Y SOLICITUD DE ASILO. En enero de 2024 sali de El Salvador ante el riesgo inminente para mi vida. Ingrese a los Estados Unidos y presente mi solicitud de asilo I-589, que se encuentra pendiente. Manifesto mi temor de ser asesinada por la MS-13 si regreso.",
    "7. TEMOR A REGRESAR. Temo que, si regreso a El Salvador, la MS-13 me matara por haberme negado a pagar la extorsion, por haber denunciado a la policia y por ser familiar de una victima de la pandilla. La MS-13 tiene presencia nacional y las autoridades no pueden ni quieren protegerme de manera efectiva.",
    "8. DECLARACION FINAL. Declaro que todo lo aqui expuesto es verdadero y correcto segun mi leal saber y entender, bajo juramento y so pena de perjurio conforme a las leyes de los Estados Unidos.",
    "Yenifer del Carmen Rodriguez Alvarado",
    "Miami, Florida. 5 de octubre de 2025.",
  ],
  payload: {
    declarant_name: "Yenifer del Carmen Rodríguez Alvarado", declaration_date: "2025-10-05", nationality: "Salvadoran",
    persecution_basis: "Particular social group (small business owners resisting gang extortion; family of a gang victim); imputed anti-gang political opinion",
    key_events: ["2023-03: MS-13 extortion begins", "2023-07: refusal + PNC report", "2023-09-12: brother killed in reprisal", "2023-Q4: direct death threats", "2024-01: fled to the U.S. and filed I-589"],
  },
};

const EVIDENCES = [
  { letter: "A", filename: "evidencia_A_denuncia_pnc", display: "Evidencia A - Denuncia PNC (extorsion)", docType: "police report", date: "2023-07-20", source: "PNC, San Miguel", title: "EVIDENCIA A - CONSTANCIA DE DENUNCIA POR EXTORSION (PNC)",
    paras: ["Policia Nacional Civil (PNC), Delegacion San Miguel. Fecha: 20 de julio de 2023.", "Denunciante: Yenifer del Carmen Rodriguez Alvarado. Hecho: extorsion continuada ('renta') por parte de miembros de la MS-13 con amenazas de muerte.", "(Documento ficticio para fines de demostracion del sistema.)"] },
  { letter: "B", filename: "evidencia_B_acta_homicidio", display: "Evidencia B - Acta de homicidio del hermano", docType: "death/police record", date: "2023-09-13", source: "PNC / Medicina Legal", title: "EVIDENCIA B - REGISTRO DE HOMICIDIO",
    paras: ["Registro de homicidio. Victima: Kevin Alexander Rodriguez, 19 anos. Fecha del hecho: 12 de septiembre de 2023, San Miguel.", "Circunstancias: disparos por dos sujetos en motocicleta frente al domicilio familiar. Investigacion sin imputados.", "(Documento ficticio para fines de demostracion del sistema.)"] },
  { letter: "C", filename: "evidencia_C_nota_amenaza", display: "Evidencia C - Nota de amenaza", docType: "threat note", date: "2023-10-01", source: "MS-13 (nota dejada en la tienda)", title: "EVIDENCIA C - TRANSCRIPCION DE NOTA DE AMENAZA",
    paras: ["Nota manuscrita dejada en la tienda de la denunciante, aprox. 1 de octubre de 2023.", "Transcripcion: 'Ya sabes lo que le paso a tu hermano. Pagas o te toca. Nada de policia.'", "(Documento ficticio para fines de demostracion del sistema.)"] },
  { letter: "D", filename: "evidencia_D_condiciones_pais", display: "Evidencia D - Condiciones del pais (El Salvador / MS-13)", docType: "country conditions", date: "2025-02-10", source: "Informe de derechos humanos (ficticio)", title: "EVIDENCIA D - CONDICIONES DEL PAIS",
    paras: ["Resumen: informes de derechos humanos documentan el control territorial de pandillas como la MS-13 en El Salvador, la practica sistematica de extorsion ('renta'), homicidios por represalia contra quienes se niegan o denuncian, y la limitada capacidad del Estado para proteger a las victimas y testigos.", "(Articulo ilustrativo para fines de demostracion; la IA debe corroborar el patron con fuentes publicas reales y verificables.)"] },
];

const PAGE_W = 612, PAGE_H = 792, MARGIN = 56, SIZE = 11, LH = 15.5;
function wrap(t, f, s, w) { const ws = t.split(/\s+/); const ls = []; let l = ""; for (const x of ws) { const tr = l ? l + " " + x : x; if (f.widthOfTextAtSize(tr, s) > w && l) { ls.push(l); l = x; } else l = tr; } if (l) ls.push(l); return ls; }
async function buildPdf(title, paras) {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const maxW = PAGE_W - MARGIN * 2; let page = pdf.addPage([PAGE_W, PAGE_H]); let y = PAGE_H - MARGIN;
  const nl = (h) => { y -= h; if (y < MARGIN + LH) { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; } };
  for (const tl of wrap(title, bold, 14, maxW)) { page.drawText(tl, { x: MARGIN, y, size: 14, font: bold, color: rgb(0.1, 0.12, 0.22) }); nl(20); }
  nl(8);
  for (const p of paras) { for (const ln of wrap(p, font, SIZE, maxW)) { page.drawText(ln, { x: MARGIN, y, size: SIZE, font, color: rgb(0, 0, 0) }); nl(LH); } nl(7); }
  return Buffer.from(await pdf.save());
}
const rawTextOf = (t, p) => t + "\n\n" + p.join("\n\n");

const I589_DOC = {
  title: "FORMULARIO I-589 (RESUMEN DEL FORMULARIO PRESENTADO)",
  paras: [
    "Este documento resume el Formulario I-589 (Solicitud de Asilo y de Suspension de Remocion) ya presentado ante USCIS por la solicitante Yenifer del Carmen Rodriguez Alvarado.",
    "Parte A.I - Informacion personal: Yenifer del Carmen Rodriguez Alvarado, nacionalidad salvadorena, nacida el 3 de marzo de 1992 en San Miguel, El Salvador. Ingreso a EE.UU. en enero de 2024. Idioma nativo: espanol.",
    "Parte B - Fundamento del asilo: pertenencia a un grupo social particular (comerciantes que resisten la extorsion de pandillas; familiares de victimas de pandillas) y opinion politica imputada contra las pandillas. Dano pasado: extorsion, amenazas de muerte y el asesinato de su hermano como represalia. Temor futuro: ser asesinada por la MS-13 si regresa.",
    "Parte C - Barreras: no hay solicitud previa de asilo; presento dentro del plazo tras su llegada; no reingreso al pais; sin antecedentes penales.",
    "Fecha de presentacion aproximada: febrero de 2024. Numero de recibo: (pendiente). Estado: pendiente ante USCIS.",
    "(Resumen ficticio para fines de demostracion del sistema; el reforzamiento anexa la declaracion jurada y las evidencias sustentatorias.)",
  ],
  payload: {
    document_type: "filed I-589 (summary)", filing_date: "2024-02", receipt_number: null, status: "pending",
    applicant: "Yenifer del Carmen Rodríguez Alvarado", nationality: "Salvadoran",
    asylum_basis: "Particular social group + imputed anti-gang political opinion",
  },
};

(async () => {
  const sb = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: prior } = await sb.from("case_documents").select("id, storage_path").eq("case_id", CASE_ID).in("required_document_type_id", [TYPE_DECLARACION, TYPE_EVIDENCIAS, TYPE_I589]);
  if (prior && prior.length) {
    const idsP = prior.map((r) => r.id);
    await sb.from("document_extractions").delete().in("case_document_id", idsP);
    await sb.from("case_documents").delete().in("id", idsP);
    const paths = prior.map((r) => r.storage_path).filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    console.log("RESET: removed " + idsP.length + " prior demo docs");
  }
  const items = [];
  items.push({ typeId: TYPE_I589, filename: "i589_presentado_yenifer", display: "Formulario I-589 completo (presentado)", title: I589_DOC.title, paras: I589_DOC.paras, payload: I589_DOC.payload });
  items.push({ typeId: TYPE_DECLARACION, filename: "declaracion_jurada_yenifer", display: "Declaración jurada de Yenifer", title: AFFIDAVIT.title, paras: AFFIDAVIT.paras, payload: AFFIDAVIT.payload });
  for (const e of EVIDENCES) items.push({ typeId: TYPE_EVIDENCIAS, filename: e.filename, display: e.display, title: e.title, paras: e.paras, payload: { document_type: e.docType, document_date: e.date, author_or_source: e.source, summary: e.paras[0] } });
  const packet = ["Este paquete consolida las evidencias A a D en apoyo del reforzamiento de la solicitud de asilo de Yenifer del Carmen Rodriguez Alvarado."];
  for (const e of EVIDENCES) { packet.push("== " + e.title + " =="); for (const p of e.paras) packet.push(p); }
  items.push({ typeId: TYPE_EVIDENCIAS, filename: "evidencias_consolidado_A_D", display: "Evidencias sustentatorias - Paquete consolidado A-D", title: "PAQUETE CONSOLIDADO DE EVIDENCIAS A-D", paras: packet, payload: { document_type: "consolidated packet", document_date: "2025-10-05", author_or_source: "Compilado por el equipo legal", summary: "Paquete consolidado de evidencias A-D (denuncia PNC, homicidio del hermano, nota de amenaza, condiciones del pais)." } });

  const base = Date.now() - items.length * 2000;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const pdf = await buildPdf(it.title, it.paras);
    const createdAt = new Date(base + i * 2000).toISOString();
    const storagePath = "case/" + CASE_ID + "/" + (base + i * 2000) + "-" + it.filename + ".pdf";
    const up = await sb.storage.from(BUCKET).upload(storagePath, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) { console.error("UPLOAD_ERROR", it.filename, up.error.message); process.exit(3); }
    const ins = await sb.from("case_documents").insert({ case_id: CASE_ID, required_document_type_id: it.typeId, party_id: null, uploaded_by: UPLOADED_BY, storage_path: storagePath, original_filename: it.filename + ".pdf", display_name: it.display, mime_type: "application/pdf", size_bytes: pdf.length, status: "approved", translation_not_required: true, service_phase_id: PHASE_ID, created_at: createdAt, updated_at: createdAt }).select("id").single();
    if (ins.error) { console.error("INSERT_DOC_ERROR", it.filename, ins.error.message); process.exit(4); }
    const rawText = rawTextOf(it.title, it.paras);
    const ext = await sb.from("document_extractions").insert({ case_document_id: ins.data.id, model: EXTRACTION_MODEL, status: "completed", payload: it.payload, raw_text: rawText, completed_at: createdAt, created_at: createdAt, updated_at: createdAt });
    if (ext.error) { console.error("INSERT_EXT_ERROR", it.filename, ext.error.message); process.exit(5); }
    console.log("OK " + it.filename + " doc=" + ins.data.id + " bytes=" + pdf.length + " raw=" + rawText.length);
  }
  console.log("\nDONE " + items.length + " documents created.");
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
