/* Diagnose why autoAssembleWithAi left an empty draft for the reforzar case.
 * Calls the real service (admin actor) with replace:true and prints result/error.
 * Usage: npx -y tsx docs/_evidence/prod-verify/85-diagnose-assembly.ts <caseId> */
import { loadEnv, IDS, staffAdminActor } from "./_env";
loadEnv();
const caseId = process.argv[2] || IDS.REFORZAR_CASE;
const ts = () => new Date().toISOString().slice(11, 19);

(async () => {
  const expediente = await import("../../../src/backend/modules/expediente");
  const actor = staffAdminActor(IDS.ORG);
  console.log(`[${ts()}] autoAssembleWithAi case=${caseId} replace=true…`);
  try {
    const res = await expediente.autoAssembleWithAi(actor, caseId, { replace: true });
    console.log(`[${ts()}] ✅ result:`, JSON.stringify(res));
  } catch (e) {
    console.log(`[${ts()}] ⛔ threw: ${(e as Error).name}: ${(e as Error).message}`);
    if ((e as { code?: string }).code) console.log("code:", (e as { code?: string }).code);
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
