/* Resume a stalled run by re-enqueuing a run-generation job to prod QStash. The engine
 * resumes from its checkpoint (progress jsonb). Unique dedupeId so QStash doesn't drop it.
 * Usage: npx -y tsx docs/_evidence/prod-verify/65-resume-run.ts <runId> [tag]
 */
import { IDS } from "./_env";
process.env.NEXT_PUBLIC_APP_URL = IDS.PROD_URL;
import { loadEnv } from "./_env";
loadEnv();

const runId = process.argv[2];
const tag = process.argv[3] || String(Date.now());
const ts = () => new Date().toISOString().slice(11, 19);

(async () => {
  const { enqueueJob } = await import("../../../src/backend/platform/qstash");
  const { createServiceClient } = await import("../../../src/backend/platform/supabase");
  const sb = createServiceClient();
  // ai_generation_runs has no org_id column (org is derived from the case inside
  // executeGenerationJob), and the run-generation payload schema ignores orgId anyway.
  const { data: run } = await sb.from("ai_generation_runs").select("version, status").eq("id", runId).single();
  console.log(`[${ts()}] run ${runId} status=${run?.status} v${run?.version} — re-enqueuing to ${process.env.NEXT_PUBLIC_APP_URL}`);
  const res = await enqueueJob(
    { jobKey: "run-generation", entityId: runId, attempt: 1, dedupeId: `run-generation:${runId}:v${run?.version}:resume-${tag}`, runId },
    { retries: 2, timeout: "290s" },
  );
  console.log(`[${ts()}] ✅ enqueued messageId=${res.messageId}`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
