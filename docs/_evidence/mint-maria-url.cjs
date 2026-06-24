/* Mint a fresh María client session cookie (base64URL — what @supabase/ssr
 * actually decodes; see CLAUDE.md). Prints the cookie value to stdout so the
 * caller can inject it via Playwright addCookies. */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../node_modules/@supabase/supabase-js"));

const env = fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8");
function get(k) {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null;
}
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY") || get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

(async () => {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({
    email: "maria.gonzalez.demo@example.com",
    password: "demo-maria!",
  });
  if (error) { console.error("LOGIN_ERROR:", error.message); process.exit(2); }
  const s = data.session;
  const obj = {
    access_token: s.access_token,
    token_type: s.token_type,
    expires_in: s.expires_in,
    expires_at: s.expires_at,
    refresh_token: s.refresh_token,
    user: s.user,
  };
  const val = "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
  fs.writeFileSync(path.join(__dirname, "maria-url.txt"), val);
  console.error("COOKIE_LEN=" + val.length);
  process.stdout.write(val);
})();
