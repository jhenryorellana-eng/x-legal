/* Download the regenerated EOIR-26 PDF and confirm: no "394"/"Apt" (apartment),
 * OCC service address = 126 Northpoint (not 8701 Gessner), street kept. */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const KEY = "case/e2528124-7255-4156-a378-ab5cffbbcf77/forms/eoir-26-230bddab-9f1b-49e9-9542-6fffc1d87466.pdf";

(async () => {
  const mupdf = await import("mupdf");
  const r = await fetch(`${URL}/storage/v1/object/generated/${KEY}?cb=${Date.now()}`, {
    headers: { Authorization: `Bearer ${SVC}`, apikey: SVC, "cache-control": "no-cache" },
  });
  if (!r.ok) { console.log("DOWNLOAD FAILED", r.status); return; }
  const buf = Buffer.from(await r.arrayBuffer());
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let all = "";
  for (let p = 0; p < doc.countPages(); p++) {
    const st = doc.loadPage(p).toStructuredText("preserve-whitespace");
    all += JSON.parse(st.asJSON()).blocks.flatMap((b) => (b.lines || []).map((l) => l.text)).join("\n") + "\n";
  }
  const checks = {
    'apartment "394" GONE': !/\b394\b/.test(all),
    'no "Gessner" (old court addr as OCC)': !/Gessner/i.test(all),
    'OCC "126 Northpoint" present': /126 Northpoint/i.test(all),
    'street "6310 BUMFRIES" kept': /6310 BUMFRIES/i.test(all),
  };
  console.log("pages:", doc.countPages(), "bytes:", buf.length);
  for (const [k, v] of Object.entries(checks)) console.log(` ${v ? "✅" : "❌"} ${k}`);
})();
