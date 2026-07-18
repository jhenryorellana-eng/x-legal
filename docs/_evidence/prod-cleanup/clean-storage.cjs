/* Limpieza de Storage para producción.
 * Borra TODOS los objetos de los buckets de datos EXCEPTO los 3 archivos del
 * caso conservado (Guillermo, U26-000027). NO toca `catalog-assets` (config).
 * Usa service-role (borra el binario real vía storage.remove()).
 *
 * Uso:  node clean-storage.cjs            (borra de verdad)
 *       node clean-storage.cjs --dry      (solo reporta, no borra)
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const DRY = process.argv.includes("--dry");
const envRaw = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => {
  const m = envRaw.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null;
};

const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL || !SERVICE) { console.error("Faltan URL/SERVICE_ROLE en .env.local"); process.exit(2); }

const sb = createClient(URL, SERVICE, { auth: { persistSession: false } });

// Buckets de datos a limpiar (catalog-assets NO se toca — es configuración)
const BUCKETS = ["case-documents", "contracts", "expedientes", "generated", "payment-proofs", "chat-attachments", "avatars"];

// Set-a-preservar por bucket (rutas exactas del caso de Guillermo, calculadas desde la BD)
const KEEP = {
  "contracts": new Set([
    "signatures/2b6fcd57-af0a-4fe9-abe8-34933f8b4638-1784047432370.jpg",
    "signatures/2c3b1cd3-b62c-49e6-b9e1-5cca347a6c68-08d47713-aeec-49de-aa66-66e91c800ce8-1784047718442.jpg",
  ]),
  "payment-proofs": new Set([
    "payment-proofs/507967f3-4374-49c0-aacd-3da464e0615c/1784047503128-firma-traduccion.png",
  ]),
};

// Lista recursiva de todas las rutas de archivo dentro de un bucket
async function listAll(bucket, prefix = "") {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        // es carpeta → recursar
        out.push(...await listAll(bucket, full));
      } else {
        out.push(full);
      }
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

(async () => {
  let totalDeleted = 0, totalKept = 0;
  const missingKeep = [];

  for (const bucket of BUCKETS) {
    const all = await listAll(bucket);
    const keepSet = KEEP[bucket] || new Set();
    const toDelete = all.filter((p) => !keepSet.has(p));
    const kept = all.filter((p) => keepSet.has(p));

    // Verificar que cada ruta a preservar realmente existe en el bucket
    for (const k of keepSet) if (!all.includes(k)) missingKeep.push(`${bucket}/${k}`);

    console.log(`\n[${bucket}] total=${all.length}  conservar=${kept.length}  borrar=${toDelete.length}`);
    if (kept.length) kept.forEach((k) => console.log(`   KEEP → ${k}`));

    totalKept += kept.length;

    if (!DRY && toDelete.length) {
      for (let i = 0; i < toDelete.length; i += 100) {
        const batch = toDelete.slice(i, i + 100);
        const { error } = await sb.storage.from(bucket).remove(batch);
        if (error) throw new Error(`remove ${bucket}: ${error.message}`);
        totalDeleted += batch.length;
      }
    } else {
      totalDeleted += toDelete.length; // en dry, contamos lo que se borraría
    }
  }

  if (missingKeep.length) {
    console.log("\n⚠ RUTAS A PRESERVAR NO ENCONTRADAS (revisar antes de confiar):");
    missingKeep.forEach((m) => console.log("   " + m));
  }
  console.log(`\n${DRY ? "[DRY] " : ""}RESUMEN → borrados=${totalDeleted}  conservados=${totalKept}  keep-faltantes=${missingKeep.length}`);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
