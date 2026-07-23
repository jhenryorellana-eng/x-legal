#!/usr/bin/env node
/**
 * Evidence script — signed Juez webhook (evaluation.completed / evaluation.failed).
 *
 * Signs the raw body with HMAC-SHA256 (hex) exactly like Juez will
 * (contract v1 §3.3 — docs/PROMPT-JUEZ-XLEGAL.md) and POSTs it to the local
 * dev server. Lets us verify the ENTIRE x-legal side without Juez deployed:
 *   - signature valid → 200; tampered → 401
 *   - evaluation.failed → attempt refund + timeline + staff notification
 *   - evaluation.completed with a non-whitelisted pdfUrl → 500 (guard works,
 *     evaluation stays in_progress so Juez/polling can retry)
 *   - evaluation.completed with a REAL *.blob.vercel-storage.com pdfUrl →
 *     delivered + PDF in the `generated` bucket (full happy path; requires a
 *     live blob URL, e.g. from the deployed Juez)
 *
 * Usage:
 *   node docs/_evidence/juez-eval/send-webhook.cjs --token <t> --job <jobId> \
 *     --event failed [--error GENERATION_FAILED] \
 *     [--base http://localhost:3100] [--secret <JUEZ_WEBHOOK_SECRET>]
 *
 *   node docs/_evidence/juez-eval/send-webhook.cjs --token <t> --job <jobId> \
 *     --event completed --pdf-url https://….blob.vercel-storage.com/x.pdf \
 *     [--score 62] [--nivel moderado] [--headline "Caso sólido"] [--tamper]
 */

const crypto = require("node:crypto");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const BASE = arg("base", "http://localhost:3100");
const TOKEN = arg("token", null);
const JOB = arg("job", null);
const EVENT = arg("event", "failed");
const SECRET = arg("secret", process.env.JUEZ_WEBHOOK_SECRET || "dev-secret");

if (!TOKEN || !JOB) {
  console.error("Missing --token and/or --job");
  process.exit(1);
}

const payload =
  EVENT === "completed"
    ? {
        event: "evaluation.completed",
        token: TOKEN,
        jobId: JOB,
        completedAt: new Date().toISOString(),
        result: {
          pdfUrl: arg("pdf-url", "https://example.blob.vercel-storage.com/missing.pdf"),
          score: Number(arg("score", "62")),
          nivel: arg("nivel", "moderado"),
          headline: arg("headline", "Evidencia de prueba — evidence run"),
        },
      }
    : {
        event: "evaluation.failed",
        token: TOKEN,
        jobId: JOB,
        error: arg("error", "GENERATION_FAILED"),
      };

const raw = JSON.stringify(payload);
let signature = crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");
if (has("tamper")) signature = signature.replace(/^./, signature[0] === "0" ? "1" : "0");

(async () => {
  console.log(`POST ${BASE}/api/webhooks/juez  event=${payload.event} jobId=${JOB}`);
  const res = await fetch(`${BASE}/api/webhooks/juez`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-juez-signature": signature },
    body: raw,
  });
  const body = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(body.slice(0, 500));

  // Duplicate delivery — same body+signature again (expect 200 + no double effects)
  if (!has("tamper") && res.ok) {
    const res2 = await fetch(`${BASE}/api/webhooks/juez`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-juez-signature": signature },
      body: raw,
    });
    console.log(`\nDuplicate delivery → HTTP ${res2.status} (expect 200, idempotent no-op)`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
