/* Regenerate the EOIR-26 filled PDF (corrected OCC address + no apartment) and
 * then re-compile the expediente. Sequential: compile reads the fresh item PDFs.
 * Usage: node docs/_evidence/apelacion-apartamento-fix/dispatch-regen.cjs [which] [port]
 *   which = "form" | "compile" | "both" (default both) */
const fs = require("node:fs");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const WHICH = process.argv[2] || "both";
const PORT = process.argv[3] || "3100";
const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const token = createHmac("sha256", get("QSTASH_CURRENT_SIGNING_KEY")).update("local-job-dispatch/v1").digest("hex");
const ORG = "a3e5f333-455a-4b3b-a5da-5a3716d24761";

const RESPONSE_ID = "230bddab-9f1b-49e9-9542-6fffc1d87466"; // EOIR-26 form response
const EXPEDIENTE_ID = "29a4ad83-1e9d-42c3-826f-99304b1fea45"; // attempt 1
const HENRY = "00000000-0000-0000-0000-000000000001"; // real staff user_id (built_by attribution)

async function dispatch(jobKey, entityId, extra) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/webhooks/qstash/${jobKey}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-job-dispatch": token },
    body: JSON.stringify({ jobKey, entityId, attempt: 1, dedupeId: `${jobKey}:${entityId}:apt-fix-r6`, orgId: ORG, ...extra }),
  });
  console.log(jobKey, "→", res.status, (await res.text()).slice(0, 400));
}

(async () => {
  if (WHICH === "form" || WHICH === "both") {
    await dispatch("regenerate-form-pdf", RESPONSE_ID, { responseId: RESPONSE_ID });
  }
  if (WHICH === "compile" || WHICH === "both") {
    await dispatch("compile-expediente", EXPEDIENTE_ID, { expedienteId: EXPEDIENTE_ID, requestedBy: HENRY });
  }
})();
