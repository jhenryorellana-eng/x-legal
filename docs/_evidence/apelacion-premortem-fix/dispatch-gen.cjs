/* Dispatch run-generation for a given run id against the local dev server.
 * Usage: node docs/_evidence/apelacion-premortem-fix/dispatch-gen.cjs <runId> [port] */
const fs = require("node:fs");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const RUN_ID = process.argv[2];
const PORT = process.argv[3] || "3100";
if (!RUN_ID) { console.error("usage: dispatch-gen.cjs <runId> [port]"); process.exit(2); }

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const token = createHmac("sha256", get("QSTASH_CURRENT_SIGNING_KEY")).update("local-job-dispatch/v1").digest("hex");
const ORG = "a3e5f333-455a-4b3b-a5da-5a3716d24761";

(async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/webhooks/qstash/run-generation`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-job-dispatch": token },
    body: JSON.stringify({
      jobKey: "run-generation",
      entityId: RUN_ID,
      attempt: 1,
      dedupeId: `run-generation:${RUN_ID}:v2`,
      runId: RUN_ID,
      orgId: ORG,
    }),
  });
  console.log("run-generation", res.status, (await res.text()).slice(0, 200));
})();
