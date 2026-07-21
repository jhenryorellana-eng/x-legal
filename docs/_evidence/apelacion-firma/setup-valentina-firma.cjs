/* E2E setup: genera un PNG transparente de firma para el caso de Valentina
 * (APE-E2E-307490), lo sube al bucket case-documents e inserta la fila case_documents
 * status='uploaded' contra el requisito firma-del-apelante — para luego aprobarla como
 * Vanessa (sales) desde la UI y regenerar las cartas. Idempotente (borra la previa). */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const ROOT = path.join(__dirname, "../../..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null; };
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const CASE_ID = "9e151193-5012-46c3-8e5b-44b7f97d4f05";
const FIRMA_REQ = "70f92459-d1e0-4da5-923a-6257e6239ba2";
const PHASE_ID = "f62fafe4-f5ef-49ac-9565-919d8c2a3ce1";
const CLIENT_ID = "15ece384-65de-4381-b958-1948f993b679";

// --- Minimal RGBA PNG encoder (no deps beyond zlib) — draws a visible signature
//     scribble on a TRANSPARENT background so we can confirm the stamp landed. ---
const zlib = require("zlib");
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function makeSignaturePng(w, h) {
  const px = Buffer.alloc(w * h * 4, 0); // RGBA, fully transparent
  const set = (x, y, r, g, b) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255; };
  const dot = (x, y) => { for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (dx * dx + dy * dy <= 5) set(x + dx, y + dy, 16, 35, 63); }; // navy #10233f
  // Flowing cursive-like stroke across the width + a couple of loops (a "signature").
  for (let t = 0; t <= 1; t += 0.0009) {
    const x = 20 + t * (w - 60);
    const y = h / 2 + Math.sin(t * Math.PI * 6) * (h * 0.22) - t * 8;
    dot(x, y);
  }
  for (let a = 0; a <= Math.PI * 2; a += 0.02) { dot(w * 0.30 + Math.cos(a) * 22, h * 0.5 + Math.sin(a) * 30); dot(w * 0.66 + Math.cos(a) * 18, h * 0.52 + Math.sin(a) * 24); }
  for (let x = 18; x < w - 30; x++) dot(x, h - 22); // underline flourish
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

(async () => {
  const png = makeSignaturePng(560, 150);
  const localCopy = path.join(__dirname, "valentina-firma.png");
  fs.writeFileSync(localCopy, png);
  console.log("PNG", png.length, "bytes ->", localCopy);

  // Borra firma previa (idempotente).
  await db.from("case_documents").delete().eq("case_id", CASE_ID).eq("required_document_type_id", FIRMA_REQ);

  const storagePath = `case/${CASE_ID}/firma-del-apelante-e2e.png`;
  const up = await db.storage.from("case-documents").upload(storagePath, png, { contentType: "image/png", upsert: true });
  if (up.error) { console.error("upload", up.error); process.exit(1); }
  console.log("uploaded ->", storagePath);

  const ins = await db.from("case_documents").insert({
    case_id: CASE_ID, required_document_type_id: FIRMA_REQ, party_id: null,
    uploaded_by: CLIENT_ID, storage_path: storagePath, original_filename: "valentina-firma.png",
    mime_type: "image/png", size_bytes: png.length, status: "uploaded",
    display_name: "Firma del apelante", service_phase_id: PHASE_ID,
  }).select("id").single();
  if (ins.error) { console.error("insert", ins.error); process.exit(1); }
  console.log("case_documents row (uploaded):", ins.data.id);
  console.log("\nDONE — firma subida (status=uploaded). Aprobar como Vanessa y regenerar las cartas.");
})().catch((e) => { console.error(e); process.exit(1); });
