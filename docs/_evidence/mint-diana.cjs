/**
 * Mints a Diana (paralegal) Supabase session and prints the SSR auth cookie
 * ({name, value}) as JSON — for Playwright addCookies / curl on localhost.
 * Usage: node docs/_evidence/mint-diana.cjs
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const envTxt = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
const get = (k) => {
  const m = envTxt.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].replace(/^["']|["']$/g, "").trim() : null;
};
const url = get("NEXT_PUBLIC_SUPABASE_URL");
const anon = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const ref = (url || "").match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1];

(async () => {
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({
    email: "diana@usalatinoprime.com",
    password: "changeme-diana!",
  });
  if (error) throw error;
  const value = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
  process.stdout.write(JSON.stringify({ name: `sb-${ref}-auth-token`, value }));
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
