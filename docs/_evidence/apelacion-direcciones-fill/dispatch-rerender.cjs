/* Re-render (NO AI) the Statement + Carátula of U26-000037 after the deterministic-fill
 * fix (effective source-resolved answers). Loopback dispatch to the running dev server
 * (:3100) whose code carries the fix. Usage: node dispatch-rerender.cjs [port] */
const fs = require("node:fs");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const PORT = process.argv[2] || "3100";
const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const token = createHmac("sha256", get("QSTASH_CURRENT_SIGNING_KEY")).update("local-job-dispatch/v1").digest("hex");
const ORG = "a3e5f333-455a-4b3b-a5da-5a3716d24761";

const RUN_IDS = [
  "4de895e1-e822-4940-8534-a4f31c22c421", // statement-of-reasons-for-appeal v1
  "b6880b7c-6e32-49fa-945a-39e522ef844f", // caratula-de-envio v1
  "fa3dd379-e6e0-4afb-be75-128015119596", // caratula-de-envio v2 (newest)
];

(async () => {
  for (const runId of RUN_IDS) {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/webhooks/qstash/rerender-run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-job-dispatch": token },
      body: JSON.stringify({
        jobKey: "rerender-run",
        entityId: runId,
        attempt: 1,
        dedupeId: `rerender-run:${runId}:dir-fill`,
        runId,
        orgId: ORG,
      }),
    });
    console.log(runId, "→", res.status, (await res.text()).slice(0, 300));
  }
})();
