/* eslint-disable */
/**
 * Ola 3 demo seed — realistic Asilo case for the "Armar con IA" e2e.
 *
 * Seeds (idempotent by the `case/<id>/seed/` storage prefix + DEMO tag):
 *   - approved client documents per party (realistic ES/EN names) with valid PDFs
 *   - one completed certified translation (es-en) for a Spanish document
 *   - one approved I-589 (Part A) form response with a filled PDF (strong doc)
 *   - one completed "Memorándum de Miedo Creíble" generation run (strong doc)
 *
 * Run: node docs/_evidence/ola3-seed.cjs
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// --- env -------------------------------------------------------------------
const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const URL = get("NEXT_PUBLIC_SUPABASE_URL") || get("SUPABASE_URL");
const KEY = get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL || !KEY) throw new Error("missing supabase env");
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// --- ids (from the seeded Asilo case ULP-2026-0011) ------------------------
const CASE = "35023394-b5b7-43cc-9111-5fcf865a9e6f";
const CLIENT = "7bef5f11-0bd8-4d63-9ae9-26bbcfbc4004";
const P = {
  carlos: "cf921484-970a-4aeb-b46f-948d23b63620", // petitioner
  daiana: "48645f0e-a89c-4035-ba77-a086c11d0106", // minor
  mateo: "a80bcc87-eefd-44b0-9772-beebf2f325cd", // minor
  sofia: "aa5ce82c-89b5-41aa-b2ed-4c2e58a46c39", // minor
  rosa: "d3e00459-1f40-4024-a8cc-7b239bcfdc6a", // spouse
};
const RDT = {
  pasaporte: "5327a85d-f3ea-495a-9863-29b6ab83347f",
  i94: "baad3780-7787-4d51-89f0-1825f0cf28b2",
  actaHijos: "366a4d61-0aec-4d0d-adec-c2d6ebc333f9",
  policial: "1f1f0fe1-8c91-4fca-afb6-b676e8b61a4a",
};
const FORM_I589A = "e7f12a89-d1dd-4478-84f3-17afff5a0b8d";
const FORM_MEMO = "b8ecfc63-323f-49e8-9e34-40679b9717a9";

// --- minimal valid 1-page PDF builder --------------------------------------
function makePdf(text) {
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
  ];
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  objs.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);
  objs.push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>");
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => (pdf += `${String(off).padStart(10, "0")} 00000 n \n`));
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

async function upload(bucket, p, text) {
  const { error } = await sb.storage.from(bucket).upload(p, makePdf(text), { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`upload ${bucket}/${p}: ${error.message}`);
  return p;
}

async function main() {
  // Idempotency: wipe prior seed rows for this case.
  const prefix = `seed/${CASE}/`;
  await sb.from("document_translations").delete().in(
    "case_document_id",
    ((await sb.from("case_documents").select("id").like("storage_path", `${prefix}%`)).data ?? []).map((r) => r.id),
  );
  await sb.from("case_documents").delete().like("storage_path", `${prefix}%`);
  await sb.from("ai_generation_runs").delete().eq("case_id", CASE).eq("is_test", true);
  await sb.from("case_form_responses").delete().eq("case_id", CASE).eq("form_definition_id", FORM_I589A);

  // 1) Client documents (approved) per party.
  const docs = [
    { name: "Pasaporte_Carlos_Ramirez.pdf", party: P.carlos, rdt: RDT.pasaporte, lang: "en" },
    { name: "I-94_Carlos.pdf", party: P.carlos, rdt: RDT.i94, lang: "en" },
    { name: "Denuncia_Policial_Carlos.pdf", party: P.carlos, rdt: RDT.policial, lang: "es" },
    { name: "Acta_Nacimiento_Sofia.pdf", party: P.sofia, rdt: RDT.actaHijos, lang: "es" }, // → translation
    { name: "Acta_Nacimiento_Mateo.pdf", party: P.mateo, rdt: RDT.actaHijos, lang: "es" },
    { name: "Pasaporte_Daiana.pdf", party: P.daiana, rdt: RDT.pasaporte, lang: "en" },
    { name: "Pasaporte_Rosa_Esposa.pdf", party: P.rosa, rdt: RDT.pasaporte, lang: "en" },
  ];
  const inserted = {};
  for (const d of docs) {
    const sp = `${prefix}${d.name}`;
    await upload("case-documents", sp, d.name.replace(/_/g, " "));
    const { data, error } = await sb
      .from("case_documents")
      .insert({
        case_id: CASE,
        required_document_type_id: d.rdt,
        party_id: d.party,
        uploaded_by: CLIENT,
        storage_path: sp,
        original_filename: d.name,
        display_name: d.name.replace(/\.pdf$/, "").replace(/_/g, " "),
        mime_type: "application/pdf",
        size_bytes: 1024,
        status: "approved",
      })
      .select("id")
      .single();
    if (error) throw new Error(`insert doc ${d.name}: ${error.message}`);
    inserted[d.name] = data.id;
  }

  // 2) Certified translation for Sofia's birth certificate.
  const trPath = `case/${CASE}/translations/sofia-acta-en.pdf`;
  await upload("generated", trPath, "Certified translation — Birth Certificate (Sofia)");
  await sb.from("document_translations").insert({
    case_document_id: inserted["Acta_Nacimiento_Sofia.pdf"],
    direction: "es-en",
    status: "completed",
    translated_pdf_path: trPath,
    requested_by: CLIENT,
    completed_at: new Date().toISOString(),
  });

  // 3) Strong doc: I-589 (Part A) filled PDF (approved form response).
  const i589Path = `case/${CASE}/forms/i589-parte-a.pdf`;
  await upload("generated", i589Path, "USCIS Form I-589 (Part A) — filled");
  await sb.from("case_form_responses").insert({
    case_id: CASE,
    form_definition_id: FORM_I589A,
    party_id: P.carlos,
    answers: { full_name: "Carlos Ramírez", country: "Venezuela" },
    status: "approved",
    filled_pdf_path: i589Path,
    submitted_at: new Date().toISOString(),
  });

  // 4) Strong doc: completed "Memorándum de Miedo Creíble" generation run.
  const memoPath = `case/${CASE}/generations/memorandum.pdf`;
  await upload("generated", memoPath, "Memorándum de Miedo Creíble");
  await sb.from("ai_generation_runs").insert({
    case_id: CASE,
    form_definition_id: FORM_MEMO,
    party_id: P.carlos,
    status: "completed",
    version: 1,
    output_path: memoPath,
    config_snapshot: { seeded: true },
    is_test: true,
    completed_at: new Date().toISOString(),
  });

  console.log("Seed OK:", Object.keys(inserted).length, "docs + 1 translation + I-589 + memo");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
