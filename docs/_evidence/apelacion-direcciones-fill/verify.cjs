/* Download the re-rendered PDFs from PROD storage and confirm the deterministic fills:
 *  - Statement: appellant address 1206 BOWER ST / LINDEN, NJ 07036 / (908) 570-0662
 *  - Carátula:  OPLA envelope 970 Broad Street, Room 1300 / Newark, NJ 07102
 * Usage: node verify.cjs */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");

const TARGETS = [
  {
    name: "Statement of Reasons v1",
    key: "generated/runs/4de895e1-e822-4940-8534-a4f31c22c421/output.pdf",
    checks: {
      'street "1206 BOWER ST"': /1206\s+BOWER\s+ST/i,
      'city/state/zip "LINDEN, NJ 07036"': /LINDEN,?\s+NJ\s+07036/i,
      'phone "(908) 570-0662"': /\(?908\)?\s*570-?0662/,
    },
  },
  {
    name: "Carátula de Envío v2",
    key: "generated/runs/fa3dd379-e6e0-4afb-be75-128015119596/output.pdf",
    checks: {
      'OPLA street "970 Broad Street, Room 1300"': /970\s+Broad\s+Street,?\s+Room\s+1300/i,
      'OPLA city "Newark, NJ 07102"': /Newark,?\s+NJ\s+07102/i,
      'client name "KIMBERLLY"': /KIMBERLLY/i,
    },
  },
];

(async () => {
  const mupdf = await import("mupdf");
  for (const t of TARGETS) {
    // The object key (t.key) already begins with "generated/"; the bucket is also
    // "generated" → /object/<bucket>/<key> = /object/generated/generated/runs/...
    const r = await fetch(`${URL}/storage/v1/object/generated/${t.key}?cb=${Date.now()}`, {
      headers: { Authorization: `Bearer ${SVC}`, apikey: SVC, "cache-control": "no-cache" },
    });
    if (!r.ok) { console.log(`\n${t.name}: DOWNLOAD FAILED`, r.status); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const doc = mupdf.Document.openDocument(buf, "application/pdf");
    let all = "";
    for (let p = 0; p < doc.countPages(); p++) {
      const st = doc.loadPage(p).toStructuredText("preserve-whitespace");
      all += JSON.parse(st.asJSON()).blocks.flatMap((b) => (b.lines || []).map((l) => l.text)).join("\n") + "\n";
    }
    console.log(`\n${t.name} — pages: ${doc.countPages()}, bytes: ${buf.length}`);
    for (const [label, re] of Object.entries(t.checks)) {
      console.log(` ${re.test(all) ? "✅" : "❌"} ${label}`);
    }
  }
})();
