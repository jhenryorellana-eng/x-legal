/* Mint a fresh María client session cookie for live MCP verification.
 * Reads URL+anon from .env.local, signs in with password, verifies the
 * user_kind claim, and writes the @supabase/ssr cookie value to a file.
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
function get(k) {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  if (!m) return null;
  return m[1].trim().replace(/^["']/, "").replace(/["']$/, "");
}

const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY") || get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

(async () => {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({
    email: "maria.gonzalez.demo@example.com",
    password: "demo-maria!",
  });
  if (error) {
    console.error("LOGIN_ERROR:", error.message);
    process.exit(2);
  }
  const s = data.session;
  const payload = JSON.parse(Buffer.from(s.access_token.split(".")[1], "base64").toString());
  console.log("user_kind=" + payload.user_kind + " org_id=" + (payload.org_id || "NONE"));
  const obj = {
    access_token: s.access_token,
    token_type: s.token_type,
    expires_in: s.expires_in,
    expires_at: s.expires_at,
    refresh_token: s.refresh_token,
    user: s.user,
  };
  const val = "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64");
  fs.writeFileSync(path.join(__dirname, "maria-fresh.txt"), val);
  console.log("COOKIE_LEN=" + val.length + " written");
})();
