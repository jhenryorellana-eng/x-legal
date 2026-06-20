/**
 * Provisions the production QStash cron schedules (DOC-26 §3 / DOC-82 §8 item 17).
 * Idempotent: deletes any existing schedule pointing at our job endpoints, then
 * recreates the canonical set. Run ONCE per environment at go-live (and again only
 * if the schedule table below changes):
 *
 *   QSTASH_TOKEN=... NEXT_PUBLIC_APP_URL=https://app.usalatinoprime.com \
 *     node scripts/provision-schedules.mjs
 *
 * The job handlers are internally idempotent (DOC-26 §1.1), so a static cron body
 * is safe — per-run dedupe is computed inside each handler.
 */
import { Client } from "@upstash/qstash";

const token = process.env.QSTASH_TOKEN;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

if (!token) throw new Error("QSTASH_TOKEN is required");
if (!appUrl || !/^https:\/\//.test(appUrl)) {
  throw new Error("NEXT_PUBLIC_APP_URL must be a https:// URL (QStash cannot call localhost)");
}

// Canonical schedule table (DOC-26 §3). Times are UTC.
const SCHEDULES = [
  { job: "installment-reminders", cron: "0 11 * * *", retries: 1 },
  { job: "appointment-reminders", cron: "*/15 * * * *", retries: 0 },
  { job: "contract-reminders", cron: "0 14 * * *", retries: 2 },
  { job: "retry-abogados-polling", cron: "0 */6 * * *", retries: 1 },
  { job: "ai-budget-aggregation", cron: "0 12 * * *", retries: 1, extra: { mode: "threshold" } },
  { job: "ai-budget-aggregation", cron: "0 13 1 * *", retries: 1, extra: { mode: "monthly-close" } },
  { job: "purge-retention", cron: "0 7 * * *", retries: 1 },
];

const dest = (job) => `${appUrl.replace(/\/$/, "")}/api/webhooks/qstash/${job}`;
const targetDestinations = new Set(SCHEDULES.map((s) => dest(s.job)));

const client = new Client({ token });

// 1. Clean slate — remove existing schedules that target our endpoints.
const existing = await client.schedules.list();
for (const s of existing) {
  if (targetDestinations.has(s.destination)) {
    await client.schedules.delete(s.scheduleId);
    console.log(`deleted existing schedule ${s.scheduleId} → ${s.destination} (${s.cron})`);
  }
}

// 2. Create the canonical set.
for (const s of SCHEDULES) {
  const body = JSON.stringify({ jobKey: s.job, entityId: null, attempt: 1, ...(s.extra ?? {}) });
  const res = await client.schedules.create({
    destination: dest(s.job),
    cron: s.cron,
    body,
    headers: { "Content-Type": "application/json" },
    retries: s.retries,
  });
  console.log(`created ${s.job} [${s.cron}]${s.extra ? " " + JSON.stringify(s.extra) : ""} → ${res.scheduleId}`);
}

console.log(`\nprovision-schedules: done (${SCHEDULES.length} schedules on ${appUrl}).`);
