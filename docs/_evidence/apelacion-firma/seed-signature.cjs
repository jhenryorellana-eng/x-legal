/* Firma del apelante — seed de datos (config-as-data). Requiere la migración 0102
 * (columnas signature_role / signature_placements) aplicada ANTES. Idempotente.
 * Autorizado por Henry. NO toca casos ni datos de clientes.
 *
 * Aplica, en el servicio `apelacion` (fase-1):
 *  1. Re-siembra system_prompt + sections de los 2 ai_letters (Statement/Proof) desde
 *     content.cjs (incluye el placeholder {{APPELLANT_SIGNATURE}}) y les fija
 *     ai_generation_configs.signature_role = 'appellant'.
 *  2. Fija form_automation_versions.signature_placements del EOIR-26 publicado (v6):
 *     los 2 spots de firma (#9 pág 2, #12 pág 5) en coordenadas nativas PDF.
 *  3. Inserta el documento requerido `firma-del-apelante` (PNG transparente que el
 *     cliente sube; revisado por el equipo; signature_role='appellant').
 *
 * Uso:  node docs/_evidence/apelacion-firma/seed-signature.cjs
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));
const CONTENT = require("../apelacion-ola3/content.cjs");

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

const PHASE_ID = "f62fafe4-f5ef-49ac-9565-919d8c2a3ce1";        // apelacion / fase-1
const EOIR26_VERSION_ID = "afab55c4-b02b-4176-9d05-3345245e9e23"; // EOIR-26 published v6

// Signature widget rects (PDF-native, bottom-left) from pdf-lib inspection — VERIFIED
// visually (docs/_evidence/apelacion-firma/verify-stamp.cjs).
const SIGNATURE_PLACEMENTS = [
  { role: "appellant", page: 2, rect: [180.6, 241.92, 531.24, 310.56] }, // #9  Signature of Person Appealing
  { role: "appellant", page: 5, rect: [184.32, 324.96, 527.4, 395.76] }, // #12 Proof of Service SIGN HERE
];

const die = (step, error) => { console.error(`FAIL [${step}]:`, error?.message ?? error); process.exit(1); };
const ok = (step, extra = "") => console.log(`OK   [${step}] ${extra}`);

async function fdIdBySlug(slug) {
  const { data, error } = await db.from("form_definitions").select("id").eq("service_phase_id", PHASE_ID).eq("slug", slug).maybeSingle();
  if (error) die(`fd ${slug}`, error);
  if (!data) die(`fd ${slug}`, "not found — run apelacion-ola3/seed.cjs first");
  return data.id;
}

async function setLetterSignature(cfg) {
  const letterId = await fdIdBySlug(cfg.slug);
  const r = await db.from("ai_generation_configs")
    .update({ system_prompt: cfg.system_prompt, sections: cfg.sections, signature_role: cfg.signature_role ?? "appellant" })
    .eq("form_definition_id", letterId);
  if (r.error) die(`gen config ${cfg.slug}`, r.error);
  // Re-siembra la rúbrica del Pre-Mortem desde la guía (incluye la nota del placeholder
  // {{APPELLANT_SIGNATURE}} para que el validador no lo marque como texto faltante).
  if (cfg.guide_path) {
    const guide = fs.readFileSync(path.join(ROOT, cfg.guide_path), "utf8");
    const g = await db.from("form_fill_guides")
      .update({ guide_markdown: guide, source_file_path: cfg.guide_path })
      .eq("form_definition_id", letterId);
    if (g.error) die(`guide ${cfg.slug}`, g.error);
  }
  ok(`ai_letter ${cfg.slug}`, "system_prompt+sections+signature_role+guide");
}

(async () => {
  // 1. Los 2 ai_letters: placeholder en el closing + signature_role.
  await setLetterSignature(CONTENT.STATEMENT);
  await setLetterSignature(CONTENT.PROOF);

  // 2. EOIR-26 (v6 publicada): signature_placements.
  {
    const r = await db.from("form_automation_versions")
      .update({ signature_placements: SIGNATURE_PLACEMENTS })
      .eq("id", EOIR26_VERSION_ID);
    if (r.error) die("eoir-26 signature_placements", r.error);
    ok("eoir-26 signature_placements", `${SIGNATURE_PLACEMENTS.length} spots`);
  }

  // 3. Documento requerido `firma-del-apelante`.
  {
    const { data: existing } = await db.from("required_document_types").select("id").eq("service_phase_id", PHASE_ID).eq("slug", "firma-del-apelante").maybeSingle();
    const row = {
      service_phase_id: PHASE_ID, slug: "firma-del-apelante",
      label_i18n: { es: "Firma del apelante", en: "Appellant's signature" },
      help_i18n: {
        es: "Sube tu firma como imagen PNG con **fondo transparente** (sin fondo blanco). Firma en papel blanco, tómale una foto y quítale el fondo, o usa una firma digital. Tu asesora la revisa: si no es transparente, te pedirá subirla de nuevo. Se coloca automáticamente en tu EOIR-26 y en las cartas de la apelación.",
        en: "Upload your signature as a PNG image with a **transparent background** (no white background). Sign on white paper, photograph it and remove the background, or use a digital signature. Your advisor reviews it; if it is not transparent, you will be asked to re-upload. It is placed automatically on your EOIR-26 and the appeal letters.",
      },
      category_i18n: { es: "Firma", en: "Signature" },
      is_required: true, is_per_party: false, party_roles: null,
      ai_extract: false, extraction_schema: null,
      requires_translation: false, requires_certified_copy: false,
      position: 6, is_active: true, accepted_format: "png", allow_multiple: false,
      signature_role: "appellant",
    };
    const r = existing
      ? await db.from("required_document_types").update(row).eq("id", existing.id)
      : await db.from("required_document_types").insert(row);
    if (r.error) die("firma-del-apelante", r.error);
    ok("firma-del-apelante", existing ? "(update)" : "(insert)");
  }

  // 4. Re-siembra la rúbrica del Pre-Mortem del EOIR-26 (§11 recalibrada: la firma
  //    estampada es correcta, no una anomalía) desde el archivo de guía editado.
  {
    const EOIR26_FD = "93512a98-b8a8-4673-b0aa-5d5cfb7b0202";
    const guidePath = "docs/guides/eoir-26-notice-of-appeal-guia.md";
    const guide = fs.readFileSync(path.join(ROOT, guidePath), "utf8");
    const r = await db.from("form_fill_guides")
      .update({ guide_markdown: guide, source_file_path: guidePath })
      .eq("form_definition_id", EOIR26_FD);
    if (r.error) die("eoir-26 form_fill_guide", r.error);
    ok("eoir-26 form_fill_guide", `${guide.length} chars`);
  }

  console.log("\nDONE — Firma del apelante sembrada (requiere migración 0102 aplicada).");
})().catch((e) => die("unhandled", e));
