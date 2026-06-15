/**
 * Simulador local del webhook del SaaS Abogados (DOC-70 §9.2).
 *
 * Firma un payload de veredicto con ABOGADOS_WEBHOOK_SECRET (HMAC-SHA256 hex
 * sobre los BYTES EXACTOS) y lo POSTea a /api/webhooks/abogados. Sirve para
 * cubrir los casos de seguridad que el SaaS real no produce a demanda: firma
 * inválida, sin firma, replay, source ajeno.
 *
 * Uso:
 *   node scripts/simulate-abogados-webhook.mjs <validation_id> <external_case_id> [opciones]
 * Opciones:
 *   --verdict=validated|needs_corrections   (default needs_corrections)
 *   --return-to=team|client                 (default team)
 *   --verdict-at=<ISO>                       (default: ahora; pásalo para replay exacto)
 *   --source=<source>                        (default usalatinoprime-v2)
 *   --corrupt-sig                            firma inválida → espera 401
 *   --no-sig                                 omite el header de firma → espera 401
 *   --url=<callback>                         (default http://localhost:3000/api/webhooks/abogados)
 *
 * El secreto se lee de process.env o, si falta, de .env.local del repo.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSecret() {
  if (process.env.ABOGADOS_WEBHOOK_SECRET) return process.env.ABOGADOS_WEBHOOK_SECRET;
  try {
    const env = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
    const m = env.match(/^ABOGADOS_WEBHOOK_SECRET=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    /* fall through */
  }
  throw new Error("ABOGADOS_WEBHOOK_SECRET no encontrado (env ni .env.local).");
}

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      opt[k] = v === undefined ? true : v;
    } else pos.push(a);
  }
  return { pos, opt };
}

const { pos, opt } = parseArgs(process.argv.slice(2));
const [validationId, externalCaseId] = pos;
if (!validationId || !externalCaseId) {
  console.error("Faltan args: <validation_id> <external_case_id>");
  process.exit(2);
}

const verdict = opt.verdict ?? "needs_corrections";
const verdictAt = opt["verdict-at"] ?? new Date().toISOString();
const source = opt.source ?? "usalatinoprime-v2";
const url = opt.url ?? "http://localhost:3000/api/webhooks/abogados";

const body = JSON.stringify({
  event: "validation.verdict",
  validation_id: validationId,
  external_case_id: externalCaseId,
  source,
  case_number: "ULP-E2E-0001",
  verdict,
  verdict_notes:
    verdict === "validated"
      ? "Expediente conforme. Listo para radicar."
      : "Reemplazar el marcador [ENTRY_DATE_PLACEHOLDER] y corregir la fecha del I-589.",
  verdict_findings:
    verdict === "validated"
      ? []
      : [
          {
            severity: "critical",
            category: "placeholder_unresolved",
            location: "Declaración de apoyo, párrafo 8",
            description: 'La carta contiene el marcador "[ENTRY_DATE_PLACEHOLDER]" sin reemplazar.',
            recommendation: "Regenera la carta tras completar el cuestionario.",
          },
        ],
  verdict_at: verdictAt,
  review_seconds: 53,
  return_to: opt["return-to"] ?? "team",
  semaforo: verdict === "validated" ? "green" : "red",
  ai_score: verdict === "validated" ? 92 : 55,
});

const secret = loadSecret();
let signature = createHmac("sha256", secret).update(body).digest("hex");
if (opt["corrupt-sig"]) signature = "deadbeef" + signature.slice(8);

const headers = { "Content-Type": "application/json" };
if (!opt["no-sig"]) headers["x-abogados-signature"] = signature;

const res = await fetch(url, { method: "POST", headers, body });
const text = await res.text();
console.log(`→ POST ${url}`);
console.log(`  verdict=${verdict} source=${source} sig=${opt["no-sig"] ? "OMITTED" : opt["corrupt-sig"] ? "CORRUPT" : "valid"}`);
console.log(`← ${res.status} ${text}`);
process.exit(res.ok ? 0 : 1);
