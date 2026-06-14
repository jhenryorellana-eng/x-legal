/* F4 FIRE TEST — real legal generation through the ai-engine pipeline.
 * Uses the saved ai_generation_config (system prompt + model) + a real case context,
 * calls Claude (real key), computes cost (DOC-74 §5), renders the memo to PDF (mupdf).
 * node docs/_evidence/f4-fire/generate.mjs
 */
import Anthropic from "@anthropic-ai/sdk";
import * as mupdf from "mupdf";
import MarkdownIt from "markdown-it";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();

const client = new Anthropic({ apiKey: get("ANTHROPIC_API_KEY") });

// Saved config (memorandum-asilo) + a real case context (no PII to the model).
const SYSTEM_PROMPT =
  "Eres un abogado de inmigración senior. Redacta un memorándum legal de asilo claro y profesional " +
  "para {{client.name}} (caso {{case.number}}), citando los hechos del caso. Estructura: " +
  "I. Introducción, II. Hechos, III. Fundamento legal (INA §208), IV. Conclusión. No inventes hechos.";
const MODEL = "claude-sonnet-4-6";

const caseContext = `# CONTEXTO DEL CASO
- Cliente: Carlos Mendoza (caso ULP-2026-0002)
- Servicio: Asilo Político
- Hechos: Periodista en su país de origen. Recibió amenazas de muerte por publicar sobre corrupción
  gubernamental. Su domicilio fue allanado. Huyó tras un atentado fallido. Cruzó la frontera y se
  presentó ante CBP solicitando asilo. Tiene artículos publicados y un reporte policial como evidencia.

## INSTRUCCIONES DE FORMATO
Escribe el memorándum completo en Markdown (## para secciones). Sé conciso pero completo.`;

// Anthropic Sonnet 4.6 pricing (per 1M tokens): in $3 / out $15 (DOC-74 §5).
const P_IN = 3, P_OUT = 15;

console.log(`\n=== F4 FIRE TEST — real generation (${MODEL}) ===\n`);
const t0 = Date.now();
const resp = await client.messages.create({
  model: MODEL,
  max_tokens: 4000,
  system: SYSTEM_PROMPT,
  messages: [{ role: "user", content: caseContext }],
});
const ms = Date.now() - t0;

const memo = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
const usage = resp.usage;
const costUsd = ((usage.input_tokens * P_IN + usage.output_tokens * P_OUT) / 1_000_000).toFixed(4);

console.log(`stop_reason: ${resp.stop_reason}`);
console.log(`tokens: in=${usage.input_tokens} out=${usage.output_tokens}`);
console.log(`cost_usd: $${costUsd}`);
console.log(`latency: ${ms}ms`);
console.log(`\n--- MEMO (first 900 chars) ---\n${memo.slice(0, 900)}\n...`);

// Render the memo to a real PDF via mupdf (same engine as renderMarkdownToPdf).
const html = `<!DOCTYPE html><html><body style="font-family:serif;font-size:11pt;margin:72pt">${new MarkdownIt().render(memo)}</body></html>`;
const htmlDoc = mupdf.Document.openDocument(new TextEncoder().encode(html), "text/html");
htmlDoc.layout(612, 792, 11);
const writer = new mupdf.DocumentWriter(new mupdf.Buffer(), "pdf", "");
// Use toPDFDocument if available, else page-run.
let pdfBytes;
try {
  const pdf = htmlDoc.toPDFDocument ? htmlDoc.toPDFDocument() : null;
  if (pdf) pdfBytes = pdf.saveToBuffer("").asUint8Array();
} catch {}
if (!pdfBytes) {
  const buf = new mupdf.Buffer();
  const w = new mupdf.DocumentWriter(buf, "pdf", "");
  for (let i = 0; i < htmlDoc.countPages(); i++) {
    const page = htmlDoc.loadPage(i);
    const dev = w.beginPage(page.getBounds());
    page.run(dev, mupdf.Matrix.identity);
    w.endPage();
  }
  w.close();
  pdfBytes = buf.asUint8Array();
}
writeFileSync(join(__dirname, "memo-asilo-generado.pdf"), pdfBytes);
writeFileSync(join(__dirname, "memo-asilo-generado.md"), memo);
console.log(`\nPDF rendered: memo-asilo-generado.pdf (${pdfBytes.length} bytes) · MD saved.`);
console.log(`\nRESULT: real legal memo generated + costed + rendered ✓`);
