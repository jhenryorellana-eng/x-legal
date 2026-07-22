/* Mint a fresh Henry (admin/staff) session cookie for live MCP verification.
 * The staff login form re-mounts under the dev server's Fast Refresh, wiping
 * typed input — so we inject the @supabase/ssr cookie directly instead. */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null;
};

const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY") || get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const REF = URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)[1];

(async () => {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({
    email: "henry@usalatinoprime.com",
    password: "changeme-henry!",
  });
  if (error) { console.error("LOGIN_ERROR:", error.message); process.exit(2); }
  const s = data.session;
  const payload = JSON.parse(Buffer.from(s.access_token.split(".")[1], "base64").toString());
  console.log("user_kind=" + payload.user_kind + " role=" + (payload.user_role || payload.role) + " org_id=" + (payload.org_id || "NONE"));
  const obj = {
    access_token: s.access_token,
    token_type: s.token_type,
    expires_in: s.expires_in,
    expires_at: s.expires_at,
    refresh_token: s.refresh_token,
    user: s.user,
  };
  // @supabase/ssr expects base64url (NOT standard base64) after the "base64-" prefix.
  const val = "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
  const cookieName = `sb-${REF}-auth-token`;
  fs.writeFileSync(path.join(__dirname, "henry-cookie.json"), JSON.stringify({ name: cookieName, value: val }));
  console.log("COOKIE_NAME=" + cookieName);
  console.log("COOKIE_LEN=" + val.length + (val.length > 3900 ? " (NEEDS CHUNKING)" : " (fits one cookie)"));
})();
