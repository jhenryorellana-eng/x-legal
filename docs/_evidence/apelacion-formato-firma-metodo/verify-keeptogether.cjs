/* Confirm the closing block of each re-rendered letter is INTACT on one page (no
 * orphaned tail across a page break). Renders the closing page to PNG too. */
const fs = require("node:fs"), path = require("node:path");
const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const SB = get("NEXT_PUBLIC_SUPABASE_URL"), SVC = get("SUPABASE_SERVICE_ROLE_KEY");

const RUNS = {
  "statement-v1": "bb3f0ff5-3607-411c-8ab7-25a85da9e78e",
  "statement-v3-newest": "871fac7f-371f-4641-bebb-7748ef42887b",
  "proof-of-service": "3d5b811b-8217-4ee6-b44e-19a983ca8510",
};
// Markers that must all land on the SAME page (the closing block).
const CLOSE = ["Respectfully submitted", "Pro Se", "Date"];

(async () => {
  const mupdf = await import("mupdf");
  for (const [label, runId] of Object.entries(RUNS)) {
    const r = await fetch(`${SB}/storage/v1/object/generated/generated/runs/${runId}/output.pdf`, { headers: { Authorization: `Bearer ${SVC}`, apikey: SVC } });
    if (!r.ok) { console.log(`\n=== ${label} === DOWNLOAD ${r.status}`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const doc = mupdf.Document.openDocument(buf, "application/pdf");
    const pages = [];
    for (let i = 0; i < doc.countPages(); i++) pages.push(JSON.parse(doc.loadPage(i).toStructuredText("preserve-whitespace").asJSON()).blocks.flatMap((b) => (b.lines || []).map((l) => l.text)).join("\n"));
    const at = CLOSE.map((m) => ({ m, p: pages.findIndex((pg) => pg.includes(m)) + 1 }));
    const found = at.filter((x) => x.p > 0);
    const intact = new Set(found.map((x) => x.p)).size === 1;
    console.log(`\n=== ${label} (${runId}) ===  pages=${pages.length}`);
    console.log(`  closing markers: ${at.map((x) => `${x.m}@p${x.p}`).join(", ")}`);
    console.log(`  closing block intact on ONE page? -> ${intact ? "✅ YES (p" + found[0].p + ")" : "❌ SPLIT"}`);
    // Render the page holding the signature (or the last page) for a human eyeball.
    let pg = pages.findIndex((pg) => /Respectfully submitted|penalty of perjury/.test(pg));
    if (pg < 0) pg = pages.length - 1;
    const pix = doc.loadPage(pg).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false);
    fs.writeFileSync(path.join(__dirname, `kt-${label}-p${pg + 1}.png`), pix.asPNG());
    console.log(`  wrote kt-${label}-p${pg + 1}.png`);
  }
})();
