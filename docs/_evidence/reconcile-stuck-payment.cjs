/**
 * One-shot: reconcile stuck Stripe payments in PRODUCTION.
 *
 * Publishes the `reconcile-stripe-payments` job to the prod webhook via QStash
 * (delivered signed → runs the real deployed handler, incl. the case→active
 * transition via the downpayment.confirmed event), then verifies the DB.
 *
 * Run: node docs/_evidence/reconcile-stuck-payment.cjs
 */
const fs = require("fs");
const path = require("path");

const envText = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { Client } = require("@upstash/qstash");
const { createClient } = require("@supabase/supabase-js");

const PROD = "https://x-legal.usalatinoprime.com";
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function snapshot(tag) {
  const { data: pays } = await sb
    .from("payments")
    .select("id, method, status, stripe_payment_intent_id, installments(number, status)")
    .eq("method", "stripe")
    .order("created_at", { ascending: true });
  const { data: kase } = await sb
    .from("cases")
    .select("case_number, status")
    .eq("case_number", "ULP-2026-0002")
    .maybeSingle();
  console.log(`\n===== ${tag} =====`);
  console.log("case ULP-2026-0002:", JSON.stringify(kase));
  for (const p of pays || []) {
    console.log(
      `  pay ${p.id.slice(0, 8)} method=${p.method} status=${p.status} intent=${p.stripe_payment_intent_id ? "set" : "null"} ` +
        `inst#${p.installments?.number}=${p.installments?.status}`,
    );
  }
}

(async () => {
  await snapshot("BEFORE");

  const client = new Client({ token: env.QSTASH_TOKEN, baseUrl: env.QSTASH_URL });
  const res = await client.publishJSON({
    url: `${PROD}/api/webhooks/qstash/reconcile-stripe-payments`,
    body: {
      jobKey: "reconcile-stripe-payments",
      entityId: null,
      attempt: 1,
      dedupeId: `reconcile-oneshot-${Date.now()}`,
    },
    retries: 1,
  });
  console.log(`\npublished to QStash → messageId=${res.messageId}`);
  console.log("waiting 14s for signed delivery + processing...");
  await new Promise((r) => setTimeout(r, 14000));

  await snapshot("AFTER");
})().catch((e) => {
  console.error("ERROR:", e.message || e);
  process.exit(1);
});
