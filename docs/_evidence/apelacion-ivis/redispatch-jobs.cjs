/* Re-dispatch orphaned local jobs (dev server memory-restart killed them mid-flight).
 * Mirrors qstash.ts local loopback dispatch: POST + x-local-job-dispatch HMAC token. */
const fs = require("node:fs");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const KEY = get("QSTASH_CURRENT_SIGNING_KEY");
const token = createHmac("sha256", KEY).update("local-job-dispatch/v1").digest("hex");

const ORG = "a3e5f333-455a-4b3b-a5da-5a3716d24761";
const RUN_ID = "f8d520ac-a302-4a53-a1c6-cc5d3b1f9432";
const PM_ID = "87903e02-e1f9-464a-994f-2d3faed96795";

async function dispatch(jobKey, payload) {
  const res = await fetch(`http://127.0.0.1:3100/api/webhooks/qstash/${jobKey}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-job-dispatch": token },
    body: JSON.stringify(payload),
  });
  console.log(jobKey, res.status, (await res.text()).slice(0, 200));
}

(async () => {
  // Fire both; the webhook runs handlers in-request (long). Don't await both fully in
  // series — launch premortem first (shorter), then generation.
  await Promise.allSettled([
    dispatch("run-premortem", {
      jobKey: "run-premortem",
      entityId: PM_ID,
      attempt: 2,
      dedupeId: `run-premortem:${PM_ID}:retry-manual-1`,
      orgId: ORG,
      assessmentId: PM_ID,
    }),
    dispatch("run-generation", {
      jobKey: "run-generation",
      entityId: RUN_ID,
      attempt: 2,
      dedupeId: `run-generation:${RUN_ID}:v2:chain-1-manual`,
      runId: RUN_ID,
      orgId: ORG,
    }),
  ]);
})();
