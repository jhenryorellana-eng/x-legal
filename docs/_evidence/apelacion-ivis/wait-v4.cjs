/* Poll until brief v4 reaches a terminal state. */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const H = { Authorization: `Bearer ${get("SUPABASE_SERVICE_ROLE_KEY")}`, apikey: get("SUPABASE_SERVICE_ROLE_KEY") };
const RUN_ID = "4f643a3a-ce67-4535-81ed-87fe2b46b2aa";

(async () => {
  const started = Date.now();
  for (;;) {
    const r = await fetch(`${get("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/ai_generation_runs?id=eq.${RUN_ID}&select=status,cost_usd,error`, { headers: H });
    const [run] = await r.json();
    const mins = Math.round((Date.now() - started) / 60000);
    console.log(`[${mins}m] run=${run?.status}`);
    if (run && !["running", "queued"].includes(run.status)) {
      console.log(JSON.stringify(run, null, 1));
      break;
    }
    if (Date.now() - started > 25 * 60000) { console.log("TIMEOUT 25m"); break; }
    await new Promise((res) => setTimeout(res, 45000));
  }
})();
