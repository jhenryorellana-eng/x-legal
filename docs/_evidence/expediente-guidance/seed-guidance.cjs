/* Guías de ensamblado del expediente por servicio (services.expediente_guidance,
 * migración 0087) — siembra en PROD.
 *
 * Autorizado por Henry (2026-07-17, plan "expediente Apelación config-como-datos").
 * Idempotente: UPDATE por slug dentro del org; re-ejecutar solo re-escribe el texto.
 * No toca casos ni datos de clientes. Las guías quedan editables desde el admin
 * (wizard de catálogo, paso "Expediente").
 *
 * Siembra:
 *  - apelacion       → orden canónico BIA (EOIR-26 → Brief → Motion-to-Remand evidence
 *                      → decisión del IJ → asilo subyacente → identificación)
 *  - asilo-politico  → orden USCIS asilo afirmativo (I-589 → memo → por familiar → evidencia)
 *  - reforzar-asilo  → memo de refuerzo → por familiar → evidencia
 *
 * Uso:  node docs/_evidence/expediente-guidance/seed-guidance.cjs
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

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

const ORG_ID = "a3e5f333-455a-4b3b-a5da-5a3716d24761";

const die = (step, error) => { console.error(`FAIL [${step}]:`, error?.message ?? error); process.exit(1); };
const ok = (step, extra = "") => console.log(`OK   [${step}] ${extra}`);

const GUIDES = {
  apelacion: `BIA APPEAL PACKAGE — CANONICAL FILING ORDER (Board of Immigration Appeals, EOIR).
Assemble the case file EXACTLY in this order:
1. "Form EOIR-26 — Notice of Appeal": the filled EOIR-26 form (automated_form artifact).
2. "Brief in Support of Appeal": the appeal brief generated for this case (ai_generation artifact).
   The brief's cited exhibits are filed automatically right behind it by the system — do NOT create
   a separate section for exhibits and do NOT classify exhibit files as uploaded documents.
3. "New Evidence in Support of Motion to Remand": an 'other' section grouping the client's NEW
   supporting evidence uploaded for the appeal (requirement "Evidencias sustentatorias" / supporting
   evidence). This evidence was NOT part of the original asylum record and supports remand under
   8 C.F.R. § 1003.2(c).
4. "Decision and Order of the Immigration Judge": an 'other' section with the IJ decision being
   appealed (requirement "Decisión y orden del Juez de Inmigración").
5. "Asylum Application as Filed (Form I-589 with Annexes)": an 'other' section with the complete
   asylum package exactly as originally filed (requirement "Asilo presentado completo con anexos").
6. A 'party' section for the appellant with the passport (requirement "Pasaporte del apelante")
   and any other identity documents — use the standard party-section title format
   ("Documents of the {role}: {name}").
Rules: use the quoted section titles above verbatim. If the context contains OTHER filled appeal forms
beyond the EOIR-26 (e.g. Form EOIR-26A — Fee Waiver Request), file each as its own 'document'
section IMMEDIATELY AFTER the Brief section and BEFORE the new evidence. Do NOT create a
"Certificate of Service" or "Proof of Service" section — it is already included inside the brief
document itself. Certified English translations are always filed IMMEDIATELY BEFORE the original
foreign-language document (8 C.F.R. § 1003.33) — the system interleaves them automatically. If an
expected artifact is missing from the context, skip its section — never invent ids.`,

  "asilo-politico": `AFFIRMATIVE ASYLUM PACKAGE — CANONICAL FILING ORDER (USCIS):
1. "Form I-589 — Application for Asylum": the filled I-589 form (automated_form artifact).
2. The applicant's declaration / asylum memorandum generated for the case (ai_generation artifact).
   Its cited exhibits are filed automatically right behind it — do not create a separate exhibits section.
3. One 'party' section per family member with their identity and civil documents: the principal
   applicant first, then the spouse, then each child.
4. "Country Conditions and Supporting Evidence": an 'other' section with the remaining evidence.
Rules: titles in English; certified translations are filed immediately BEFORE each original document;
never invent ids for missing artifacts.`,

  "reforzar-asilo": `ASYLUM STRENGTHENING PACKAGE — CANONICAL FILING ORDER:
1. The strengthening letter / memorandum generated for the case (ai_generation artifact). Its cited
   exhibits are filed automatically right behind it — do not create a separate exhibits section.
2. One 'party' section per family member with their documents (principal applicant first).
3. "Supporting Evidence": an 'other' section with the remaining uploads.
Rules: titles in English; certified translations are filed immediately BEFORE each original document;
never invent ids for missing artifacts.`,
};

(async () => {
  for (const [slug, guide] of Object.entries(GUIDES)) {
    const { data, error } = await db
      .from("services")
      .update({ expediente_guidance: guide })
      .eq("org_id", ORG_ID)
      .eq("slug", slug)
      .select("id, slug");
    if (error) die(slug, error);
    if (!data || data.length === 0) die(slug, `service '${slug}' not found in org ${ORG_ID}`);
    ok(slug, `${guide.length} chars`);
  }

  // Verify: read back what runtime code will see.
  const { data: check, error: checkErr } = await db
    .from("services")
    .select("slug, expediente_guidance")
    .eq("org_id", ORG_ID)
    .order("slug");
  if (checkErr) die("verify", checkErr);
  for (const row of check ?? []) {
    console.log(`     ${row.slug}: ${row.expediente_guidance ? row.expediente_guidance.split("\n")[0] : "(sin guía)"}`);
  }
  console.log("DONE");
})();
