// Live smoke test for the exhibit Renderer (Urlbox) + acquire content-type branch.
// Run: node docs/_evidence/exhibits-ola1/urlbox-smoke.mjs
// Reads URLBOX_SECRET from .env.local. Writes sample PDFs to the OS temp dir.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function loadEnv() {
  const txt = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const SECRET = process.env.URLBOX_SECRET;
if (!SECRET) throw new Error("URLBOX_SECRET missing from .env.local");

const isPdf = (buf) => buf.subarray(0, 4).toString("latin1") === "%PDF";

async function render(url) {
  const opts = {
    url,
    format: "pdf",
    pdf_page_size: "Letter",
    pdf_print_background: true,
    block_ads: true,
    hide_cookie_banners: true,
    wait_until: "requestsfinished",
  };
  const res = await fetch("https://api.urlbox.com/v1/render/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`render ${url} → HTTP ${res.status} ${ct} :: ${body.slice(0, 300)}`);
  }
  // Resilient to either contract: JSON {renderUrl} (download step) OR direct PDF bytes.
  if (ct.includes("application/json")) {
    const j = await res.json();
    if (!j.renderUrl) throw new Error(`render ${url} → JSON without renderUrl: ${JSON.stringify(j).slice(0, 300)}`);
    const pdfRes = await fetch(j.renderUrl);
    if (!pdfRes.ok) throw new Error(`download ${j.renderUrl} → HTTP ${pdfRes.status}`);
    return { bytes: Buffer.from(await pdfRes.arrayBuffer()), via: "json+renderUrl", renderUrl: j.renderUrl };
  }
  return { bytes: Buffer.from(await res.arrayBuffer()), via: "direct-bytes", contentType: ct };
}

async function directPdf(url) {
  // Mirrors acquire()'s PDF branch: a source that is already a PDF is downloaded as-is.
  const res = await fetch(url, { redirect: "follow" });
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const bytes = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, ct, bytes };
}

const cases = [
  { label: "simple page (example.com)", url: "https://example.com" },
  { label: "news/report page (HTML → render)", url: "https://www.hrw.org/world-report/2024/country-chapters/venezuela" },
];

console.log("== Urlbox Renderer smoke test ==");
for (const c of cases) {
  const t0 = Date.now();
  try {
    const r = await render(c.url);
    const ms = Date.now() - t0;
    const ok = isPdf(r.bytes);
    const out = join(tmpdir(), `exhibit-${c.url.replace(/[^a-z0-9]/gi, "_").slice(0, 40)}.pdf`);
    writeFileSync(out, r.bytes);
    console.log(`[${ok ? "OK" : "FAIL"}] ${c.label}: ${r.bytes.length} bytes, %PDF=${ok}, via=${r.via}, ${ms}ms → ${out}`);
  } catch (e) {
    console.log(`[ERROR] ${c.label}: ${e.message}`);
  }
}

console.log("\n== Direct-PDF branch smoke test ==");
const pdfUrl = "https://www.uscis.gov/sites/default/files/document/forms/i-589.pdf";
try {
  const r = await directPdf(pdfUrl);
  console.log(`[${r.ok && isPdf(r.bytes) ? "OK" : "FAIL"}] direct PDF (USCIS I-589): ${r.bytes.length} bytes, ct=${r.ct}, %PDF=${isPdf(r.bytes)}`);
} catch (e) {
  console.log(`[ERROR] direct PDF: ${e.message}`);
}
