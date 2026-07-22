/* Download the compiled expediente PDF and confirm the corrections propagated:
 * no "394"/"Apt"/"Gessner"/"8701" in the EOIR-26 + Statement pages; 126 Northpoint present. */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const KEY = "case/e2528124-7255-4156-a378-ab5cffbbcf77/29a4ad83-1e9d-42c3-826f-99304b1fea45-a1.pdf";

(async () => {
  const mupdf = await import("mupdf");
  const r = await fetch(`${URL}/storage/v1/object/expedientes/${KEY}?cb=${Date.now()}`, {
    headers: { Authorization: `Bearer ${SVC}`, apikey: SVC, "cache-control": "no-cache" },
  });
  if (!r.ok) { console.log("DOWNLOAD FAILED", r.status); return; }
  const buf = Buffer.from(await r.arrayBuffer());
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const total = doc.countPages();
  const terms = ["8701", "394", "Gessner", "126 Northpoint", "6310", "Apt "];
  const found = Object.fromEntries(terms.map((t) => [t, []]));
  for (let p = 0; p < Math.min(total, 16); p++) {
    const st = doc.loadPage(p).toStructuredText("preserve-whitespace");
    const txt = JSON.parse(st.asJSON()).blocks.flatMap((b) => (b.lines || []).map((l) => l.text)).join("\n");
    for (const t of terms) if (txt.includes(t)) found[t].push(p + 1);
  }
  console.log(`compiled expediente: ${total} pages, ${buf.length} bytes`);
  for (const t of terms) console.log(`  "${t}" -> pages [${found[t].join(", ") || "none"}]`);
})();
