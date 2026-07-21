/* E2E ola4 — prepara el caso REAL de Ivis Palma (U26-000038) para regenerar el
 * paquete con documentos SIN espacios en blanco:
 *   1. Aprueba los 3 documentos reales (pasaporte / asilo / decisión) ya subidos+extraídos.
 *   2. Sube y aprueba la firma del apelante (reutiliza valentina-firma.png).
 * Idempotente. NO re-extrae (las extracciones ya están completas). Service-role.
 * Uso: node docs/_evidence/apelacion-ola4/setup-ivis-case.cjs */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const ROOT = path.join(__dirname, "../../..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null; };
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const CASE_ID = "e2528124-7255-4156-a378-ab5cffbbcf77";
const CLIENT_ID = "85878b64-0034-4b0c-b6c0-53ff7f120c57";
const HENRY = "00000000-0000-0000-0000-000000000001";
const FIRMA_REQ = "70f92459-d1e0-4da5-923a-6257e6239ba2";
const PHASE_ID = "f62fafe4-f5ef-49ac-9565-919d8c2a3ce1";

const die = (s, e) => { console.error(`FAIL [${s}]:`, e?.message ?? e); process.exit(1); };
const ok = (s, x = "") => console.log(`OK   [${s}] ${x}`);

(async () => {
  // 1. Aprobar los 3 documentos reales (uploaded → approved).
  {
    const r = await db.from("case_documents")
      .update({ status: "approved", reviewed_by: HENRY, reviewed_at: new Date().toISOString() })
      .eq("case_id", CASE_ID).eq("status", "uploaded")
      .select("id, required_document_type_id");
    if (r.error) die("approve docs", r.error);
    ok("approve docs", `${(r.data ?? []).length} aprobados`);
  }

  // 2. Firma del apelante (reutiliza valentina-firma.png). Idempotente: borra previa.
  {
    const png = fs.readFileSync(path.join(__dirname, "../apelacion-firma/valentina-firma.png"));
    await db.from("case_documents").delete().eq("case_id", CASE_ID).eq("required_document_type_id", FIRMA_REQ);
    const storagePath = `case/${CASE_ID}/firma-del-apelante-ola4.png`;
    const up = await db.storage.from("case-documents").upload(storagePath, png, { contentType: "image/png", upsert: true });
    if (up.error) die("upload firma", up.error);
    const ins = await db.from("case_documents").insert({
      case_id: CASE_ID, required_document_type_id: FIRMA_REQ, party_id: null,
      uploaded_by: CLIENT_ID, storage_path: storagePath, original_filename: "firma-ivis.png",
      mime_type: "image/png", size_bytes: png.length, status: "approved",
      reviewed_by: HENRY, reviewed_at: new Date().toISOString(), service_phase_id: PHASE_ID,
    });
    if (ins.error) die("insert firma", ins.error);
    ok("firma", `${png.length} bytes, approved`);
  }

  console.log("\nDONE — caso Ivis (U26-000038) listo para regenerar el paquete.");
})().catch((e) => die("unhandled", e));
