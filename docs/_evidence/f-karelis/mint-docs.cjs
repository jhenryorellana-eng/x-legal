/* Ola 1 — Demo Karelis (ULP-2026-0024).
 * Genera PDFs falsos/inventados (Declaración jurada + Evidencias sustentatorias),
 * los sube al bucket `case-documents` (service_role → bypass RLS), inserta las filas
 * `case_documents` y siembra `document_extractions` deterministas (status='completed',
 * raw_text = texto exacto del PDF) para que el memo de Miedo Creíble los lea.
 *
 * Datos FALSOS pero coherentes con el I-589 ya cargado (persona: periodista venezolana).
 * Idempotente: al re-ejecutar, borra sus propios docs previos de estos dos slugs.
 *
 * Uso:  node docs/_evidence/f-karelis/mint-docs.cjs
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));
const { PDFDocument, StandardFonts, rgb } = require(path.join(__dirname, "../../../node_modules/pdf-lib"));

// ---- env ----
const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
function envGet(k) {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null;
}
const URL = envGet("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE = envGet("SUPABASE_SERVICE_ROLE_KEY");
if (!URL || !SERVICE_ROLE) {
  console.error("MISSING_ENV: need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

// ---- constants (verified against prod) ----
const CASE_ID = "559220ae-796b-4110-ab45-bfc7eea6a564";
const PHASE_ID = "10218501-fde6-488a-a11a-8b9ed4c41fc6"; // principal
const UPLOADED_BY = "128eb5de-1ba3-442f-9fbb-1e5402358e82"; // Karelis (client)
const TYPE_DECLARACION = "b1ad0ea0-3c2d-4e97-a54f-685cb0daafe6";
const TYPE_EVIDENCIAS = "c91ca7e1-716c-4bdd-8798-ea0c77c36b39";
const BUCKET = "case-documents";
const EXTRACTION_MODEL = "gemini-2.5-flash";

// ---- narrative content (WinAnsi-safe: no em-dash / curly quotes) ----
const AFFIDAVIT = {
  title: "DECLARACION JURADA",
  paras: [
    "Yo, Karelis Andreina Perez, mayor de edad, de nacionalidad venezolana, nacida en Caracas el 14 de mayo de 1988, titular del pasaporte venezolano No. P12345678 y del numero de extranjero A123456789, actualmente residenciada en 8425 NW 53rd Street, Apt 12, Doral, Florida 33166, declaro bajo juramento y so pena de perjurio lo siguiente:",
    "1. IDENTIDAD Y PROFESION. Soy periodista de investigacion. Trabaje en el diario El Nacional, en Caracas, desde marzo de 2012 hasta agosto de 2025, y soy miembro del Sindicato Nacional de Trabajadores de la Prensa (SNTP). Mi trabajo se centro en la cobertura de corrupcion y derechos humanos.",
    "2. TRABAJO QUE MOTIVO LA PERSECUCION. Entre 2023 y 2024 publique una serie de reportajes que documentaban la malversacion de fondos publicos por parte de funcionarios regionales vinculados al partido de gobierno. Los reportajes identificaban contratos irregulares y el desvio de recursos destinados a hospitales publicos.",
    "3. AMENAZAS. El 18 de febrero de 2024 comence a recibir amenazas anonimas de muerte por telefono y por mensajes de texto, en las que se me exigia detener las publicaciones o atenerme a las consecuencias. Reporte estas amenazas al SNTP el mismo dia. Adjunto la transcripcion como Evidencia A.",
    "4. ALLANAMIENTO. El 12 de septiembre de 2024, aproximadamente a las 5:30 de la manana, varios hombres armados vestidos de civil, que se identificaron como funcionarios de seguridad del Estado (presuntamente del SEBIN), irrumpieron en mi vivienda. Revisaron mi oficina, incautaron mi computadora y documentos, y amenazaron con hacerme desaparecer si continuaba con mi trabajo. Interpuse una denuncia ante el CICPC (Evidencia B) y recibi atencion medica por las lesiones y el estres sufridos (Evidencia C).",
    "5. ORDEN DE ARRESTO. En junio de 2025, un contacto dentro de los cuerpos de seguridad me advirtio de la existencia de una orden de arresto en mi contra por supuestos delitos de instigacion al odio y traicion a la patria, cargos que el gobierno utiliza habitualmente contra periodistas y disidentes.",
    "6. HUIDA. Ante el riesgo inminente para mi vida y mi libertad, hui de Venezuela. Ingrese a los Estados Unidos por el Aeropuerto Internacional de Miami en agosto de 2025 con un permiso de parole, y manifeste de inmediato mi temor de ser perseguida si regresaba a mi pais.",
    "7. TEMOR A REGRESAR. Temo que, si regreso a Venezuela, sere detenida arbitrariamente, torturada o desaparecida por el SEBIN o por colectivos armados afines al gobierno, debido a mi trabajo periodistico y a mis opiniones politicas. El Estado venezolano controla la policia, la fiscalia y los tribunales, por lo que no existe ninguna autoridad interna ante la cual pueda solicitar proteccion efectiva.",
    "8. DECLARACION FINAL. Declaro que todo lo aqui expuesto es verdadero y correcto segun mi leal saber y entender. Firmo la presente declaracion bajo juramento y so pena de perjurio conforme a las leyes de los Estados Unidos.",
    "Karelis Andreina Perez",
    "Doral, Florida. 20 de septiembre de 2025.",
  ],
  payload: {
    declarant_name: "Karelis Andreína Pérez",
    declaration_date: "2025-09-20",
    nationality: "Venezuelan",
    persecution_basis: "Political opinion; particular social group (investigative journalists)",
    key_events: [
      "2023-2024: investigative series on public-funds embezzlement",
      "2024-02-18: anonymous death threats",
      "2024-09-12: armed raid on her home by presumed SEBIN agents",
      "2025-06: warning of an arrest warrant",
      "2025-08: fled Venezuela, entered the U.S. at Miami on parole",
    ],
  },
};

const EVIDENCES = [
  {
    letter: "A",
    filename: "evidencia_A_amenaza",
    display: "Evidencia A - Mensaje de amenaza",
    docType: "threat letter",
    date: "2024-02-18",
    source: "Anonymous text message",
    title: "EVIDENCIA A - TRANSCRIPCION DE MENSAJE DE AMENAZA",
    paras: [
      "Fecha: 18 de febrero de 2024. Medio: mensaje de texto recibido en el telefono de Karelis Andreina Perez desde un numero desconocido.",
      "Transcripcion literal: Sabemos quien eres y donde vive tu familia. Deja de publicar mentiras contra la revolucion o atente a las consecuencias. Es tu ultima advertencia.",
      "Nota: este mensaje fue reportado al Sindicato Nacional de Trabajadores de la Prensa (SNTP) el mismo dia de su recepcion.",
    ],
  },
  {
    letter: "B",
    filename: "evidencia_B_denuncia_cicpc",
    display: "Evidencia B - Denuncia CICPC",
    docType: "police report",
    date: "2024-09-13",
    source: "CICPC, Sub-delegacion Caracas",
    title: "EVIDENCIA B - CONSTANCIA DE DENUNCIA (CICPC)",
    paras: [
      "Cuerpo de Investigaciones Cientificas, Penales y Criminalisticas (CICPC), Sub-delegacion Caracas.",
      "Expediente No. K-24-0154-00987. Fecha de la denuncia: 13 de septiembre de 2024.",
      "Denunciante: Karelis Andreina Perez, titular de la cedula de identidad venezolana.",
      "Hechos denunciados: la denunciante manifiesta que el 12 de septiembre de 2024, siendo aproximadamente las 5:30 horas, sujetos armados no identificados irrumpieron en su domicilio, sustrajeron equipos de computo y documentos de trabajo, y profirieron amenazas contra su vida y la de su familia.",
      "(Documento ficticio elaborado unicamente para fines de demostracion del sistema.)",
    ],
  },
  {
    letter: "C",
    filename: "evidencia_C_informe_medico",
    display: "Evidencia C - Informe medico",
    docType: "medical report",
    date: "2024-09-14",
    source: "Centro medico (ficticio)",
    title: "EVIDENCIA C - INFORME MEDICO",
    paras: [
      "Centro medico (ficticio). Fecha de evaluacion: 14 de septiembre de 2024.",
      "Paciente: Karelis Andreina Perez, 36 anos de edad.",
      "Motivo de consulta: contusiones en el brazo derecho y cuadro de ansiedad aguda posterior a un evento de violencia ocurrido en su domicilio.",
      "Hallazgos: hematomas compatibles con sujecion forzada del antebrazo; sintomas compatibles con estres post-traumatico. Se indica reposo relativo y apoyo psicologico.",
      "(Informe ficticio elaborado unicamente para fines de demostracion del sistema.)",
    ],
  },
  {
    letter: "D",
    filename: "evidencia_D_nota_prensa",
    display: "Evidencia D - Nota de prensa (condiciones del pais)",
    docType: "press article",
    date: "2025-01-15",
    source: "Reportaje de prensa (ficticio)",
    title: "EVIDENCIA D - NOTA DE PRENSA / CONDICIONES DEL PAIS",
    paras: [
      "Titular: Organizaciones denuncian aumento de la persecucion contra periodistas en Venezuela. Fecha: enero de 2025.",
      "Resumen: organizaciones de derechos humanos y de libertad de prensa documentan un patron creciente de detenciones arbitrarias, allanamientos y amenazas contra periodistas de investigacion en Venezuela, atribuidos a organismos de seguridad del Estado como el SEBIN. El informe describe censura, cierre de medios y el uso de cargos de instigacion al odio para criminalizar el trabajo periodistico.",
      "(Articulo ilustrativo para fines de demostracion; durante la generacion, la IA debe corroborar el patron con fuentes publicas reales y verificables.)",
    ],
  },
  {
    letter: "E",
    filename: "evidencia_E_carta_testigo",
    display: "Evidencia E - Carta de testigo",
    docType: "witness letter",
    date: "2025-07-10",
    source: "Colega del SNTP (ficticio)",
    title: "EVIDENCIA E - CARTA DE TESTIGO",
    paras: [
      "Fecha: 10 de julio de 2025.",
      "Yo, colega y miembro del Sindicato Nacional de Trabajadores de la Prensa (SNTP), hago constar que conozco a Karelis Andreina Perez desde hace mas de diez anos como colega en el diario El Nacional.",
      "Doy fe de que fui testigo de las amenazas que ella comenzo a recibir a partir de febrero de 2024 y de que, tras el allanamiento de su vivienda en septiembre de 2024, la vi con lesiones visibles y en evidente estado de temor por su vida. Sus reportajes sobre corrupcion son ampliamente conocidos en el gremio periodistico.",
      "(Carta ficticia elaborada unicamente para fines de demostracion del sistema.)",
    ],
  },
];

// ---- PDF helpers ----
const PAGE_W = 612, PAGE_H = 792, MARGIN = 56, SIZE = 11, LH = 15.5;
function wrap(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const trial = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}
async function buildPdf(title, paras) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const maxW = PAGE_W - MARGIN * 2;
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const newline = (h) => {
    y -= h;
    if (y < MARGIN + LH) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };
  // title
  for (const tl of wrap(title, bold, 14, maxW)) {
    page.drawText(tl, { x: MARGIN, y, size: 14, font: bold, color: rgb(0.1, 0.12, 0.22) });
    newline(20);
  }
  newline(8);
  for (const p of paras) {
    for (const ln of wrap(p, font, SIZE, maxW)) {
      page.drawText(ln, { x: MARGIN, y, size: SIZE, font, color: rgb(0, 0, 0) });
      newline(LH);
    }
    newline(7); // paragraph gap
  }
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
function rawTextOf(title, paras) {
  return title + "\n\n" + paras.join("\n\n");
}

// ---- main ----
(async () => {
  const sb = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 0) idempotency: wipe prior demo docs of these two slugs for this case
  const { data: prior } = await sb
    .from("case_documents")
    .select("id, storage_path")
    .eq("case_id", CASE_ID)
    .in("required_document_type_id", [TYPE_DECLARACION, TYPE_EVIDENCIAS]);
  if (prior && prior.length) {
    const ids = prior.map((r) => r.id);
    await sb.from("document_extractions").delete().in("case_document_id", ids);
    await sb.from("case_documents").delete().in("id", ids);
    const paths = prior.map((r) => r.storage_path).filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    console.log("RESET: removed " + ids.length + " prior demo docs");
  }

  // build the ordered work list; consolidated packet is LAST → newest created_at → what the memo reads
  const items = [];
  items.push({
    typeId: TYPE_DECLARACION,
    filename: "declaracion_jurada_karelis",
    display: "Declaración jurada de Karelis",
    title: AFFIDAVIT.title,
    paras: AFFIDAVIT.paras,
    payload: AFFIDAVIT.payload,
  });
  for (const e of EVIDENCES) {
    items.push({
      typeId: TYPE_EVIDENCIAS,
      filename: e.filename,
      display: e.display,
      title: e.title,
      paras: e.paras,
      payload: { document_type: e.docType, document_date: e.date, author_or_source: e.source, summary: e.paras[0] },
    });
  }
  // consolidated A-E packet (read by the memo)
  const packetParas = [];
  packetParas.push("Este paquete consolida las evidencias A a E presentadas en apoyo de la solicitud de asilo de Karelis Andreina Perez. Cada seccion corresponde a una evidencia individual.");
  for (const e of EVIDENCES) {
    packetParas.push("== " + e.title + " ==");
    for (const p of e.paras) packetParas.push(p);
  }
  items.push({
    typeId: TYPE_EVIDENCIAS,
    filename: "evidencias_consolidado_A_E",
    display: "Evidencias sustentatorias - Paquete consolidado A-E",
    title: "PAQUETE CONSOLIDADO DE EVIDENCIAS A-E",
    paras: packetParas,
    payload: {
      document_type: "consolidated packet",
      document_date: "2025-09-20",
      author_or_source: "Compilado por el equipo legal",
      summary: "Paquete consolidado de las evidencias A-E (amenaza, denuncia CICPC, informe medico, nota de prensa, carta de testigo).",
    },
  });

  const base = Date.now() - items.length * 2000;
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const pdf = await buildPdf(it.title, it.paras);
    const createdAt = new Date(base + i * 2000).toISOString();
    const storagePath = "case/" + CASE_ID + "/" + (base + i * 2000) + "-" + it.filename + ".pdf";

    const up = await sb.storage.from(BUCKET).upload(storagePath, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) { console.error("UPLOAD_ERROR", it.filename, up.error.message); process.exit(3); }

    const ins = await sb.from("case_documents").insert({
      case_id: CASE_ID,
      required_document_type_id: it.typeId,
      party_id: null,
      uploaded_by: UPLOADED_BY,
      storage_path: storagePath,
      original_filename: it.filename + ".pdf",
      display_name: it.display,
      mime_type: "application/pdf",
      size_bytes: pdf.length,
      status: "approved",
      translation_not_required: true,
      service_phase_id: PHASE_ID,
      created_at: createdAt,
      updated_at: createdAt,
    }).select("id").single();
    if (ins.error) { console.error("INSERT_DOC_ERROR", it.filename, ins.error.message); process.exit(4); }
    const docId = ins.data.id;

    const rawText = rawTextOf(it.title, it.paras);
    const ext = await sb.from("document_extractions").insert({
      case_document_id: docId,
      model: EXTRACTION_MODEL,
      status: "completed",
      payload: it.payload,
      raw_text: rawText,
      completed_at: createdAt,
      created_at: createdAt,
      updated_at: createdAt,
    });
    if (ext.error) { console.error("INSERT_EXT_ERROR", it.filename, ext.error.message); process.exit(5); }

    out.push({ slug: it.typeId === TYPE_DECLARACION ? "declaracion-jurada" : "evidencias-sustentatorias", file: it.filename, docId, bytes: pdf.length, rawLen: rawText.length });
    console.log("OK " + it.filename + " doc=" + docId + " bytes=" + pdf.length + " raw=" + rawText.length);
  }
  console.log("\nDONE " + out.length + " documents created. Consolidated packet (last) = newest → read by the memo.");
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
