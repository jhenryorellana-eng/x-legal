/* Re-render (NO AI) the appeal letters after the deterministic inputs were fixed
 * (apartment removed from the I-589 extraction; OCC address corrected).
 * Mirrors the local loopback dispatch: POST + x-local-job-dispatch HMAC token.
 * Usage: node docs/_evidence/apelacion-apartamento-fix/dispatch-rerender.cjs [port] */
const fs = require("node:fs");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const PORT = process.argv[2] || "3100";
const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const token = createHmac("sha256", get("QSTASH_CURRENT_SIGNING_KEY")).update("local-job-dispatch/v1").digest("hex");
const ORG = "a3e5f333-455a-4b3b-a5da-5a3716d24761";

// Statement of Reasons — v1 (the one currently in the expediente) + v2 (newest).
const RUN_IDS = [
  "bb3f0ff5-3607-411c-8ab7-25a85da9e78e", // statement v1 (in the bundle)
  "43c7a035-7860-4350-9ce7-fb05ecd3264e", // statement v2 (newest)
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
        dedupeId: `rerender-run:${runId}:apt-fix`,
        runId,
        orgId: ORG,
      }),
    });
    console.log(runId, "→", res.status, (await res.text()).slice(0, 300));
  }
})();
