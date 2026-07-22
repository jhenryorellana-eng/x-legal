/**
 * unblock-phone.cjs — clears the client phone-login rate-limit counters for ONE
 * phone in production Upstash Redis. Use when a legit client is stuck on
 * "Demasiados intentos" and can't wait for the window to expire.
 *
 * SAFETY: only deletes keys that contain the given phone's digits. IP tiers are
 * left untouched (they are shared across clients behind the same egress IP).
 *
 * Reads creds from env (never hard-coded). Run from the repo root, e.g.:
 *   UPSTASH_REDIS_REST_URL=https://... UPSTASH_REDIS_REST_TOKEN=... \
 *     node docs/_evidence/ratelimit-login/unblock-phone.cjs 18019189664
 *
 * To pull prod creds first (writes prod secrets to a gitignored file):
 *   vercel env pull .env.vercel.local   # then source those two vars
 */
const { Redis } = require("@upstash/redis");

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error(
    "Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN in env.\n" +
      "Get them from Vercel (project x-legal) and pass them inline, or run\n" +
      "`vercel env pull` first.",
  );
  process.exit(1);
}

const raw = process.argv[2] || "18019189664";
const digits = raw.replace(/\D/g, "");
if (digits.length < 10) {
  console.error(`"${raw}" doesn't look like a phone number.`);
  process.exit(1);
}
const e164 = digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+1${digits}`;

// Cover BOTH prefixes: the legacy otp:send tiers (what blocks on the CURRENT
// prod build) and the new phone-login tiers (post-deploy). Phone tiers only.
const patterns = [
  `rl:otp:send:phone:*${digits}*`,
  `rl:client:phone-login:phone:*${digits}*`,
];

const redis = new Redis({ url, token });

(async () => {
  let total = 0;
  for (const match of patterns) {
    let cursor = 0;
    do {
      const [next, keys] = await redis.scan(cursor, { match, count: 200 });
      cursor = next;
      if (keys.length) {
        await redis.del(...keys);
        total += keys.length;
        for (const k of keys) console.log("deleted:", k);
      }
    } while (String(cursor) !== "0");
  }
  console.log(`\nDone. Deleted ${total} key(s) for ${e164} (${digits}).`);
  if (total === 0) {
    console.log("No matching keys — the phone is not currently rate-limited.");
  }
})().catch((err) => {
  console.error("Failed:", err?.message ?? err);
  process.exit(1);
});
