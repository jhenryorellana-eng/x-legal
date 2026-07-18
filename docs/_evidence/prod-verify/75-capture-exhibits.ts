/* Fase 3.4 — Manually drive the exhibits capture for a completed run (the on-completion
 * event consumer is fire-and-forget and gets cut off when the Vercel function freezes after
 * returning 200). captureFromRun creates case_exhibits rows + enqueues fetch-exhibit jobs;
 * with NEXT_PUBLIC_APP_URL=prod those run on prod Vercel and render via urlbox.
 * Usage: npx -y tsx docs/_evidence/prod-verify/75-capture-exhibits.ts <runId> */
import { IDS } from "./_env";
process.env.NEXT_PUBLIC_APP_URL = IDS.PROD_URL;
import { loadEnv } from "./_env";
loadEnv();

const runId = process.argv[2];
const ts = () => new Date().toISOString().slice(11, 19);

(async () => {
  const exhibits = await import("../../../src/backend/modules/exhibits");
  console.log(`[${ts()}] captureFromRun runId=${runId} (callback ${process.env.NEXT_PUBLIC_APP_URL})…`);
  const res = await exhibits.captureFromRun({ runId });
  console.log(`[${ts()}] captureFromRun result:`, JSON.stringify(res));
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
