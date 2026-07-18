/* Fase 3.2/3.3 — Trigger a memo generation via the REAL prod path.
 * Overriding NEXT_PUBLIC_APP_URL to the prod domain makes startGeneration's enqueueJob
 * publish to real QStash -> the deployed Vercel webhook runs executeGenerationJob (with
 * self-chaining across invocations). We only insert the queued run + enqueue; prod does the work.
 *
 * Usage: npx -y tsx docs/_evidence/prod-verify/60-trigger-memo.ts <asilo|reforzar>
 */
import * as fs from "fs";
import * as path from "path";
import { IDS, staffAdminActor } from "./_env";

// Must be set BEFORE loadEnv (which only fills unset vars) and before importing the backend.
process.env.NEXT_PUBLIC_APP_URL = IDS.PROD_URL;
import { loadEnv } from "./_env";
loadEnv();

const which = (process.argv[2] || "asilo").toLowerCase();
const ts = () => new Date().toISOString().slice(11, 19);

(async () => {
  const svc = await import("../../../src/backend/modules/ai-engine/service");
  const { createServiceClient } = await import("../../../src/backend/platform/supabase");
  const sb = createServiceClient();

  let caseId: string, formId: string, orgId: string, label: string;
  if (which === "asilo") {
    const ids = JSON.parse(fs.readFileSync(path.resolve(__dirname, "asilo-ids.json"), "utf8"));
    caseId = ids.caseId; formId = IDS.MEMO_ASILO_FORM; orgId = ids.orgId; label = "asilo";
  } else {
    const ids = JSON.parse(fs.readFileSync(path.resolve(__dirname, "reforzar-ids.json"), "utf8"));
    caseId = ids.caseId; formId = IDS.MEMO_REFORZAR_FORM; orgId = ids.orgId; label = "reforzar";
  }

  console.log(`[${ts()}] callback base = ${process.env.NEXT_PUBLIC_APP_URL}`);
  console.log(`[${ts()}] startGeneration ${label} case=${caseId} form=${formId}…`);
  const actor = staffAdminActor(orgId);
  const started = await svc.startGeneration(actor, { caseId, formDefinitionId: formId, partyId: null });
  const run = (started as { run: { id: string; version: number; status: string } }).run;
  console.log(`[${ts()}] ✅ run ${run.id} v${run.version} status=${run.status} — enqueued to QStash (prod Vercel will execute)`);

  const outFile = path.resolve(__dirname, `memo-${label}-run.txt`);
  fs.writeFileSync(outFile, run.id);
  console.log(`[${ts()}] run id written to ${outFile}`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
