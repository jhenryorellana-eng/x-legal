/* Poll PROD DB until brief v2 run + EOIR-26 pre-mortem reach terminal state. */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL_BASE = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
const H = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE };

const RUN_ID = "f8d520ac-a302-4a53-a1c6-cc5d3b1f9432";
const PM_ID = "87903e02-e1f9-464a-994f-2d3faed96795";

async function q(pathq) {
  const r = await fetch(`${URL_BASE}/rest/v1/${pathq}`, { headers: H });
  return r.json();
}

(async () => {
  const started = Date.now();
  for (;;) {
    const [run] = await q(`ai_generation_runs?id=eq.${RUN_ID}&select=status,cost_usd,error,output_text`);
    const [pm] = await q(`case_pre_mortem_assessments?id=eq.${PM_ID}&select=status,score,semaforo,verdict,error`);
    const runDone = run && !["running", "queued"].includes(run.status);
    const pmDone = pm && !["running", "queued"].includes(pm.status);
    const mins = Math.round((Date.now() - started) / 60000);
    console.log(`[${mins}m] run=${run?.status} pm=${pm?.status} pmScore=${pm?.score ?? "-"}`);
    if (runDone && pmDone) {
      console.log(JSON.stringify({
        run: { status: run.status, cost: run.cost_usd, error: run.error, textLen: (run.output_text || "").length },
        preMortem: { status: pm.status, score: pm.score, semaforo: pm.semaforo, verdict: pm.verdict, error: pm.error },
      }, null, 1));
      break;
    }
    if (Date.now() - started > 30 * 60000) { console.log("TIMEOUT 30m"); break; }
    await new Promise((r) => setTimeout(r, 30000));
  }
})();
