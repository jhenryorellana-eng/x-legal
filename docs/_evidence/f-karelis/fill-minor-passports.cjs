/* Sube 3 pasaportes falsos (hijos menores) para completar los documentos de Karelis
 * al 100% y desbloquear el gate de Ola 2. Datos ficticios. */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));
const { PDFDocument, StandardFonts, rgb } = require(path.join(__dirname, "../../../node_modules/pdf-lib"));

const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null; };
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");

const CASE_ID = "559220ae-796b-4110-ab45-bfc7eea6a564";
const PHASE_ID = "10218501-fde6-488a-a11a-8b9ed4c41fc6";
const UPLOADED_BY = "128eb5de-1ba3-442f-9fbb-1e5402358e82";
const PASAPORTE_TYPE = "5327a85d-f3ea-495a-9863-29b6ab83347f";
const MINORS = [
  { party: "dc8e95cd-4e55-4ea9-97ee-62b09dcd1027", name: "Alexander Martinez Perez", pass: "P22222221" },
  { party: "73cba7c7-b889-4829-b2e9-196b93751c44", name: "Amanda Martinez Perez", pass: "P22222222" },
  { party: "a2adb289-5810-4a58-a8d2-b1ff1af34780", name: "Kamila Martinez Perez", pass: "P22222223" },
];

async function buildPassport(name, pass) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 400]);
  page.drawText("REPUBLICA BOLIVARIANA DE VENEZUELA", { x: 56, y: 340, size: 13, font: bold, color: rgb(0.1, 0.12, 0.22) });
  page.drawText("PASAPORTE (documento ficticio de demostracion)", { x: 56, y: 318, size: 11, font });
  const lines = [`Nombre: ${name}`, `Numero de pasaporte: ${pass}`, "Nacionalidad: Venezolana", "Tipo: P  -  Menor de edad"];
  lines.forEach((l, i) => page.drawText(l, { x: 56, y: 270 - i * 26, size: 12, font }));
  return Buffer.from(await pdf.save());
}

(async () => {
  const sb = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const base = Date.now();
  for (let i = 0; i < MINORS.length; i++) {
    const m = MINORS[i];
    const pdf = await buildPassport(m.name, m.pass);
    const createdAt = new Date(base + i * 1000).toISOString();
    const storagePath = `case/${CASE_ID}/${base + i * 1000}-pasaporte_${m.name.split(" ")[0].toLowerCase()}.pdf`;
    const up = await sb.storage.from("case-documents").upload(storagePath, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) { console.error("UPLOAD", m.name, up.error.message); process.exit(3); }
    const ins = await sb.from("case_documents").insert({
      case_id: CASE_ID, required_document_type_id: PASAPORTE_TYPE, party_id: m.party, uploaded_by: UPLOADED_BY,
      storage_path: storagePath, original_filename: `pasaporte_${m.name.split(" ")[0].toLowerCase()}.pdf`,
      display_name: `Pasaporte de ${m.name.split(" ")[0]}`, mime_type: "application/pdf", size_bytes: pdf.length,
      status: "approved", translation_not_required: true, service_phase_id: PHASE_ID, created_at: createdAt, updated_at: createdAt,
    }).select("id").single();
    if (ins.error) { console.error("INSERT", m.name, ins.error.message); process.exit(4); }
    console.log(`OK ${m.name} doc=${ins.data.id}`);
  }
  console.log("DONE — 3 minor passports uploaded; Karelis documents now 100%.");
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
