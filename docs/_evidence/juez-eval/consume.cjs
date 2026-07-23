#!/usr/bin/env node
/**
 * Evidence script — Juez server-to-server API (session GET + consume).
 *
 * Exercises, against a running dev server (npx next dev -p 3100):
 *   1. GET  /api/juez/sessions/{token}            (200 wire format)
 *   2. GET  with a wrong api key                  (401)
 *   3. POST /api/juez/sessions/{token}/consume    (200 consumed)
 *   4. POST same jobId again                      (200 idempotent, no extra burn)
 *   5. POST a NEW jobId                           (409 NO_ATTEMPTS_LEFT when allowed=1)
 *
 * Usage:
 *   node docs/_evidence/juez-eval/consume.cjs --token <access_token> \
 *     [--base http://localhost:3100] [--key <JUEZ_API_KEY>]
 *
 * The token is case_evaluations.access_token (visible via Supabase MCP:
 *   select access_token from case_evaluations where case_id = '...';)
 */

const crypto = require("node:crypto");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const BASE = arg("base", "http://localhost:3100");
const TOKEN = arg("token", null);
const KEY = arg("key", process.env.JUEZ_API_KEY || "dev-key");

if (!TOKEN) {
  console.error("Missing --token <case_evaluations.access_token>");
  process.exit(1);
}

async function show(label, res) {
  const body = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body.slice(0, 300);
  }
  console.log(`\n== ${label} → HTTP ${res.status}`);
  console.log(JSON.stringify(parsed, null, 2));
  return parsed;
}

(async () => {
  // 1. Session GET
  const s1 = await fetch(`${BASE}/api/juez/sessions/${TOKEN}`, {
    headers: { "x-api-key": KEY },
  });
  await show("GET session (valid key)", s1);

  // 2. Wrong key → 401
  const s2 = await fetch(`${BASE}/api/juez/sessions/${TOKEN}`, {
    headers: { "x-api-key": "wrong-key" },
  });
  await show("GET session (wrong key — expect 401)", s2);

  // 3. Consume with a fresh jobId
  const jobId = crypto.randomUUID();
  const c1 = await fetch(`${BASE}/api/juez/sessions/${TOKEN}/consume`, {
    method: "POST",
    headers: { "x-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
  await show(`POST consume jobId=${jobId}`, c1);

  // 4. Same jobId again → idempotent 200
  const c2 = await fetch(`${BASE}/api/juez/sessions/${TOKEN}/consume`, {
    method: "POST",
    headers: { "x-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
  await show("POST consume SAME jobId (expect 200 idempotent)", c2);

  // 5. A second, different jobId → 409 when attempts_allowed=1
  const jobId2 = crypto.randomUUID();
  const c3 = await fetch(`${BASE}/api/juez/sessions/${TOKEN}/consume`, {
    method: "POST",
    headers: { "x-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ jobId: jobId2 }),
  });
  await show("POST consume NEW jobId (expect 409 if allowed=1)", c3);

  // Final session state
  const s3 = await fetch(`${BASE}/api/juez/sessions/${TOKEN}`, {
    headers: { "x-api-key": KEY },
  });
  await show("GET session (final state)", s3);

  console.log(`\njobId used (pass it to send-webhook.cjs): ${jobId}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
