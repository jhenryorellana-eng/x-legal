/* Poll until the brief v2 pre-mortem reaches a terminal state. */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const H = { Authorization: `Bearer ${get("SUPABASE_SERVICE_ROLE_KEY")}`, apikey: get("SUPABASE_SERVICE_ROLE_KEY") };
const PM_ID = "786fe568-6914-4e38-9839-567114ba3870";

(async () => {
  const started = Date.now();
  for (;;) {
    const r = await fetch(`${get("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/case_pre_mortem_assessments?id=eq.${PM_ID}&select=status,score,semaforo,verdict,cost_usd,error`, { headers: H });
    const [pm] = await r.json();
    const mins = Math.round((Date.now() - started) / 60000);
    console.log(`[${mins}m] pm=${pm?.status} score=${pm?.score ?? "-"}`);
    if (pm && !["running", "queued"].includes(pm.status)) {
      console.log(JSON.stringify(pm, null, 1));
      break;
    }
    if (Date.now() - started > 20 * 60000) { console.log("TIMEOUT 20m"); break; }
    await new Promise((res) => setTimeout(res, 30000));
  }
})();
