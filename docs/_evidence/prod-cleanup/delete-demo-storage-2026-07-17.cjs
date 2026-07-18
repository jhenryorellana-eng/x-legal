// Deletes demo-case files from Supabase Storage via the Storage API (service role).
// Reads the manifest produced from the DB inventory; removes in batches per bucket.
const fs = require("node:fs");
const path = require("node:path");

const REPO = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const { createClient } = require(path.join(REPO, "node_modules/@supabase/supabase-js"));

const env = {};
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"); process.exit(1); }

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "storage-manifest.json"), "utf8"));
const supabase = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  let totalOk = 0, totalErr = 0;
  for (const [bucket, names] of Object.entries(manifest)) {
    for (let i = 0; i < names.length; i += 50) {
      const batch = names.slice(i, i + 50);
      const { data, error } = await supabase.storage.from(bucket).remove(batch);
      if (error) {
        totalErr += batch.length;
        console.error(`[${bucket}] batch ${i / 50}: ERROR ${error.message}`);
      } else {
        totalOk += data.length;
        console.log(`[${bucket}] removed ${data.length}/${batch.length}`);
        if (data.length !== batch.length) {
          const returned = new Set(data.map((d) => d.name));
          for (const n of batch) if (!returned.has(n)) console.warn(`  not returned (missing?): ${n}`);
        }
      }
    }
  }
  console.log(`DONE removed=${totalOk} errors=${totalErr}`);
  process.exit(totalErr ? 1 : 0);
})();
