/* Re-dispatch ONLY the pre-mortem after resetting its row to queued. */
const fs = require("node:fs");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const token = createHmac("sha256", get("QSTASH_CURRENT_SIGNING_KEY")).update("local-job-dispatch/v1").digest("hex");

const PM_ID = "87903e02-e1f9-464a-994f-2d3faed96795";

(async () => {
  const res = await fetch(`http://127.0.0.1:3100/api/webhooks/qstash/run-premortem`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-job-dispatch": token },
    body: JSON.stringify({
      jobKey: "run-premortem",
      entityId: PM_ID,
      attempt: 3,
      dedupeId: `run-premortem:${PM_ID}:retry-manual-2`,
      orgId: "a3e5f333-455a-4b3b-a5da-5a3716d24761",
      assessmentId: PM_ID,
    }),
  });
  console.log("run-premortem", res.status, (await res.text()).slice(0, 200));
})();
