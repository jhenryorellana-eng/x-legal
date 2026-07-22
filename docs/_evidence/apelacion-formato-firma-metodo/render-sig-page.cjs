/* Render the page that carries "Respectfully submitted," (the signature block) for
 * each Statement version — the signature spacing lives there, not on the last page. */
const fs = require("node:fs"), path = require("node:path");
const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const SB = get("NEXT_PUBLIC_SUPABASE_URL"), SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const RUNS = {
  "statement-v1": "bb3f0ff5-3607-411c-8ab7-25a85da9e78e",
  "statement-v3-newest": "871fac7f-371f-4641-bebb-7748ef42887b",
};
(async () => {
  const mupdf = await import("mupdf");
  for (const [label, runId] of Object.entries(RUNS)) {
    const r = await fetch(`${SB}/storage/v1/object/generated/generated/runs/${runId}/output.pdf`, { headers: { Authorization: `Bearer ${SVC}`, apikey: SVC } });
    const buf = Buffer.from(await r.arrayBuffer());
    const doc = mupdf.Document.openDocument(buf, "application/pdf");
    let pg = doc.countPages() - 1;
    for (let p = 0; p < doc.countPages(); p++) {
      const st = doc.loadPage(p).toStructuredText("preserve-whitespace");
      if (/Respectfully submitted/.test(st.asJSON())) { pg = p; break; }
    }
    const pix = doc.loadPage(pg).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false);
    fs.writeFileSync(path.join(__dirname, `${label}-signature-page.png`), pix.asPNG());
    console.log(`${label}: signature on page ${pg + 1}/${doc.countPages()} -> ${label}-signature-page.png`);
  }
})();
