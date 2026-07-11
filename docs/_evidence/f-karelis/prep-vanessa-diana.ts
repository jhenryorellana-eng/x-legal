/**
 * Karelis (ULP-2026-0024) — Vanessa's flow → handoff to Diana (live, PROD).
 *
 * Runs the REAL service functions with a staff-admin Actor (role admin bypasses the
 * permission matrix; requireCaseAccess only checks org match):
 *   1. Hides the non-applicable OPTIONAL, case-level document requirements (Vanessa)
 *      — the granular evidence types are superseded by the consolidated
 *      `evidencias-sustentatorias` package already uploaded.
 *   2. Submits the Credible-Fear questionnaire (draft → submitted).
 *   3. Transfers the case sales → legal, assigning it to Diana (force: admin).
 *
 * Usage: npx -y tsx docs/_evidence/f-karelis/prep-vanessa-diana.ts
 */
import * as fs from "fs";
import * as path from "path";

// --- bootstrap .env.local BEFORE importing modules (they validate env on import) ---
const envPath = path.resolve(__dirname, "../../../.env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const CASE_ID = "559220ae-796b-4110-ab45-bfc7eea6a564";
const QUESTIONNAIRE_FORM_ID = "138f4f0e-88fb-4694-baa0-2981964d8bfc"; // memorandum-de-miedo-creible-cuestionario
const HENRY_ADMIN = "00000000-0000-0000-0000-000000000001";
const DIANA_PARALEGAL = "00000000-0000-0000-0000-000000000003";

// Optional, case-level (partyId=null) requirements to hide — superseded / N/A for Karelis.
const HIDE = [
  ["acta-matrimonio", "4ab209de-399f-4844-a7d5-92c9f3ee5a62"],
  ["evidencia-policial", "1f1f0fe1-8c91-4fca-afb6-b676e8b61a4a"],
  ["evidencia-medica", "4bb39df6-ed92-493d-9b21-28209419d835"],
  ["evidencia-psicologica", "18d8727c-9af8-457e-a1d3-2c8e11e0e1ef"],
  ["evidencia-amenazas", "2ac9b3c7-29e2-496b-805f-6359b9b97e29"],
  ["evidencia-prensa", "a6ae3ce4-c8f7-4339-92c8-445346551e9a"],
  ["carta-testigo", "94f31856-51ac-400b-855e-c916891ac605"],
] as const;

(async () => {
  const { createServiceClient } = await import("../../../src/backend/platform/supabase");
  const cases = await import("../../../src/backend/modules/cases/service");

  const sb = createServiceClient();
  const { data: c, error } = await sb.from("cases").select("org_id, current_stage, current_owner_id").eq("id", CASE_ID).single();
  if (error || !c) throw new Error("case not found: " + (error?.message ?? ""));

  const actor = {
    userId: HENRY_ADMIN,
    orgId: c.org_id as string,
    kind: "staff" as const,
    role: "admin" as const,
    permissions: new Map(),
  };

  console.log("== 1) Hiding non-applicable optional documents (Vanessa) ==");
  for (const [slug, requirementId] of HIDE) {
    try {
      await cases.setRequirementVisibility(actor, { caseId: CASE_ID, requirementId, partyId: null, hidden: true });
      console.log(`  hidden: ${slug}`);
    } catch (e) {
      console.log(`  skip ${slug}: ${(e as Error).message}`);
    }
  }

  console.log("== 2) Submitting the Credible-Fear questionnaire (draft → submitted) ==");
  try {
    const res = await cases.submitFormResponse(actor, {
      caseId: CASE_ID,
      formDefinitionId: QUESTIONNAIRE_FORM_ID,
      partyId: null,
    });
    console.log(`  questionnaire status: ${res.status}`);
  } catch (e) {
    console.log(`  submit skipped/failed (memo still generates from draft): ${(e as Error).message}`);
  }

  console.log("== 3) Transfer sales → legal (assign to Diana) ==");
  try {
    const t = await cases.transferCase(actor, { caseId: CASE_ID, toOwnerId: DIANA_PARALEGAL, force: true, note: "Prep demo: listo para generar el Memorándum de Miedo Creíble" });
    console.log(`  transferred → stage=${t.stage} owner=${t.ownerId}`);
  } catch (e) {
    console.log(`  transfer failed: ${(e as Error).message}`);
  }

  const { data: after } = await sb.from("cases").select("current_stage, current_owner_id").eq("id", CASE_ID).single();
  console.log("== Final case state ==", after);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
