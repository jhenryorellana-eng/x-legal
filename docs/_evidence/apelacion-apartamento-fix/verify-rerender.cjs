/* Download the re-rendered letter PDFs from Storage and confirm the deterministic
 * fix landed: no "Apt 394", correct appellant street/city kept. */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");

const RUNS = {
  "statement v1 (in bundle)": "bb3f0ff5-3607-411c-8ab7-25a85da9e78e",
  "statement v2 (newest)": "43c7a035-7860-4350-9ce7-fb05ecd3264e",
};

function textOf(doc) {
  let out = "";
  for (let p = 0; p < doc.countPages(); p++) {
    const st = doc.loadPage(p).toStructuredText("preserve-whitespace");
    out += JSON.parse(st.asJSON()).blocks
      .flatMap((b) => (b.lines || []).map((l) => l.text))
      .join("\n") + "\n";
  }
  return out;
}

(async () => {
  const mupdf = await import("mupdf");
  for (const [label, runId] of Object.entries(RUNS)) {
    const key = `generated/runs/${runId}/output.pdf`;
    const r = await fetch(`${URL}/storage/v1/object/generated/${key}`, {
      headers: { Authorization: `Bearer ${SVC}`, apikey: SVC },
    });
    if (!r.ok) { console.log(`\n=== ${label} ===\n  DOWNLOAD FAILED ${r.status}`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const doc = mupdf.Document.openDocument(buf, "application/pdf");
    const text = textOf(doc);
    const hasApt = /\bApt\b|394/.test(text);
    const addr = (text.match(/Address:[^\n]*/) || [])[0] || "(no 'Address:' line)";
    const csz = (text.match(/City \/ State \/ ZIP:[^\n]*/) || [])[0] || "";
    console.log(`\n=== ${label} (${runId}) ===`);
    console.log(`  bytes=${buf.length}  pages=${doc.countPages()}`);
    console.log(`  "Apt"/"394" present? -> ${hasApt ? "❌ STILL THERE" : "✅ GONE"}`);
    console.log(`  ${addr.trim()}`);
    if (csz) console.log(`  ${csz.trim()}`);
  }
})();
