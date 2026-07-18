/* Re-dispatch the v4 pre-mortem after the dev-server kill, then poll to terminal. */
const fs = require("node:fs");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const token = createHmac("sha256", get("QSTASH_CURRENT_SIGNING_KEY")).update("local-job-dispatch/v1").digest("hex");
const H = { Authorization: `Bearer ${get("SUPABASE_SERVICE_ROLE_KEY")}`, apikey: get("SUPABASE_SERVICE_ROLE_KEY") };

const PM_ID = "bd579437-5635-4152-8406-47b9a7ce5074";

(async () => {
  const dispatch = fetch(`http://127.0.0.1:3100/api/webhooks/qstash/run-premortem`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-job-dispatch": token },
    body: JSON.stringify({
      jobKey: "run-premortem",
      entityId: PM_ID,
      attempt: 2,
      dedupeId: `run-premortem:${PM_ID}:retry-manual-1`,
      orgId: "a3e5f333-455a-4b3b-a5da-5a3716d24761",
      assessmentId: PM_ID,
    }),
  }).then(async (r) => console.log("dispatch:", r.status, (await r.text()).slice(0, 120)))
    .catch((e) => console.log("dispatch error:", e.message));

  const started = Date.now();
  for (;;) {
    await new Promise((res) => setTimeout(res, 30000));
    const r = await fetch(`${get("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/case_pre_mortem_assessments?id=eq.${PM_ID}&select=status,score,semaforo,verdict,cost_usd,error`, { headers: H });
    const [pm] = await r.json();
    const mins = Math.round((Date.now() - started) / 60000);
    console.log(`[${mins}m] pm=${pm?.status} score=${pm?.score ?? "-"}`);
    if (pm && !["running", "queued"].includes(pm.status)) {
      console.log(JSON.stringify(pm, null, 1));
      break;
    }
    if (Date.now() - started > 20 * 60000) { console.log("TIMEOUT 20m"); break; }
  }
  await dispatch;
})();
