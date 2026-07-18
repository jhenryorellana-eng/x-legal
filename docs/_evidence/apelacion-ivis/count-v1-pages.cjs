/* Download brief v1 PDF from Storage (service role) and count pages via mupdf. */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL_BASE = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");

const OBJECT = "generated/runs/c6b5e681-cdbc-45a0-8c4a-96b876e45f96/output.pdf";
const BUCKET = "generated";

(async () => {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${OBJECT}`, {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
  });
  if (!res.ok) {
    console.error("download failed", res.status, await res.text());
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(__dirname, "brief-v1-old-engine.pdf"), buf);
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  console.log(JSON.stringify({ bytes: buf.length, pages: doc.countPages() }));
})();
