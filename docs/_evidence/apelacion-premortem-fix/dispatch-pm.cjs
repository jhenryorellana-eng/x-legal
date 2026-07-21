/* Dispatch run-premortem for the two Ivis letters (existing v1 runs) against the
 * local dev server, to verify the false positives are gone with the new code+guides.
 * Usage: node docs/_evidence/apelacion-premortem-fix/dispatch-pm.cjs [port]  */
const fs = require("node:fs");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const PORT = process.argv[2] || "3100";
const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const token = createHmac("sha256", get("QSTASH_CURRENT_SIGNING_KEY")).update("local-job-dispatch/v1").digest("hex");
const ORG_ID = "a3e5f333-455a-4b3b-a5da-5a3716d24761";

const TARGETS = [
  { label: "Statement v2", pm: "21e71cb8-f912-407a-948e-3122029b9e94" },
  { label: "Proof (sig fix)", pm: "b416b9df-14e8-435c-b59d-0ae65f7a1e7b" },
];

(async () => {
  for (const t of TARGETS) {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/webhooks/qstash/run-premortem`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-job-dispatch": token },
      body: JSON.stringify({
        jobKey: "run-premortem",
        entityId: t.pm,
        attempt: 1,
        dedupeId: `run-premortem:${t.pm}:verify`,
        orgId: ORG_ID,
        assessmentId: t.pm,
      }),
    });
    console.log(t.label, "→", res.status, (await res.text()).slice(0, 120));
  }
})();
