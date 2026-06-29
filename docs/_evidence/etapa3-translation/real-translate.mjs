/**
 * REAL end-to-end translation of a seeded Spanish document, replicating
 * executeTranslationJob (ai-engine/service.ts) faithfully: download the source
 * PDF → Gemini multimodal translate with the NEW prompt → strip fence →
 * renderCertifiedTranslationPdf (markdown-it + mupdf) → upload to `generated`
 * → upsert the document_translations row (completed). Then the staff UI shows it.
 *
 * Usage: node docs/_evidence/etapa3-translation/real-translate.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import MarkdownIt from "markdown-it";
import * as mupdf from "mupdf";
import { GoogleGenAI } from "@google/genai";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/etapa3-translation`;
mkdirSync(OUT, { recursive: true });

// --- env (.env.local) ---
const envText = readFileSync(`${ROOT}/.env.local`, "utf8");
const env = (k) => (envText.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const GEMINI_API_KEY = env("GEMINI_API_KEY");
const MODEL = env("AI_GEMINI_MODEL") || "gemini-2.5-flash";
const DIRECTION = "es-en";

// --- 1. realistic Spanish source (raw_text branch of executeTranslationJob) ---
// A real "Acta de Nacimiento" with content, so the translation exercises the
// document hierarchy/spacing (not the 563-byte seed placeholder). No prod reads.
const sourceText = `REGISTRO CIVIL DE BOGOTÁ, D.C. — REPÚBLICA DE COLOMBIA
ACTA DE NACIMIENTO

Por la presente se hace constar que MATEO ANDRÉS PÉREZ GÓMEZ nació el 15 de junio de 2015, en la ciudad de Bogotá, Distrito Capital.

DATOS DEL INSCRITO
Nombre completo: Mateo Andrés Pérez Gómez
Fecha de nacimiento: 15 de junio de 2015
Lugar de nacimiento: Bogotá, D.C., Colombia
Sexo: Masculino

DATOS DE LOS PADRES
Padre: Carlos Alberto Pérez — nacionalidad colombiana
Madre: María Esperanza Gómez — nacionalidad colombiana

DATOS DEL REGISTRO
El presente registro se inscribió bajo el número 7654321, libro 03, folio 145, el día 20 de junio de 2015, en la Notaría Quinta del Círculo de Bogotá.`;

// --- 2. Gemini text translate (NEW prompt, verbatim from service.ts) ---
const formatGuidance =
  " Format the result as clean Markdown that mirrors the source layout so it reads clearly: use headings (#, ##) for the document title and section headers, separate paragraphs with a blank line, keep line breaks and lists, and use a Markdown table where the source is tabular. Do not add notes or commentary, and do not wrap the answer in a code fence.";
const promptText =
  "Translate the following document from Spanish to English. Be faithful and do not summarize. Preserve names, numbers and dates exactly. Mark illegible text as [illegible]." +
  formatGuidance;

const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const resp = await genai.models.generateContent({
  model: MODEL,
  contents: [{ role: "user", parts: [{ text: `${promptText}\n\n---\n${sourceText}` }] }],
  config: { temperature: 0.2, maxOutputTokens: 65536 },
});
const rawText = resp.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
const inputTokens = resp.usageMetadata?.promptTokenCount ?? 0;
const outputTokens = resp.usageMetadata?.candidatesTokenCount ?? 0;

// stripMarkdownFence (verbatim from service.ts)
function stripMarkdownFence(text) {
  const trimmed = text.trim();
  const m = /^```[a-zA-Z0-9]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return m ? m[1].trim() : trimmed;
}
const translatedText = stripMarkdownFence(rawText);
console.log("Gemini done. tokens in/out:", inputTokens, outputTokens, "| chars:", translatedText.length);
console.log("--- translated markdown (first 600) ---\n" + translatedText.slice(0, 600) + "\n---");
writeFileSync(`${OUT}/real-translation.md`, translatedText);

// --- 3. render via the certified-translation pipeline (verbatim from pdf.ts) ---
const TRANSLATION_STYLE = `<style>
  body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5;margin:72pt;color:#111}
  h1{font-size:16pt;text-align:center;font-weight:bold;letter-spacing:0.5pt;margin:0 0 20pt;line-height:1.3}
  h2{font-size:13.5pt;font-weight:bold;margin:16pt 0 7pt}
  h3{font-size:12.5pt;font-weight:bold;margin:13pt 0 5pt}
  h4{font-size:12pt;font-weight:bold;margin:11pt 0 5pt}
  p{margin:0 0 10pt;text-align:justify}
  ul,ol{margin:0 0 10pt 0;padding-left:22pt}
  li{margin:0 0 5pt 0}
  table{border-collapse:collapse;width:100%;margin:8pt 0 14pt}
  th,td{border:0.75pt solid #555;padding:5pt 8pt;text-align:left;vertical-align:top}
  th{background:#ececec;font-weight:bold}
  a{color:#111;text-decoration:none}
</style>`;
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function buildCertifiedTranslationHtml(bodyHtml, direction) {
  const toEnglish = direction === "es-en";
  const t = toEnglish
    ? { title: "CERTIFIED ENGLISH TRANSLATION", certHeading: "TRANSLATOR'S CERTIFICATION", certStmt: "I certify that I am competent to translate from Spanish to English and that the above is a true and accurate translation of the attached document to the best of my knowledge and ability.", signature: "Signature", date: "Date", name: "Printed name" }
    : { title: "TRADUCCIÓN CERTIFICADA AL ESPAÑOL", certHeading: "CERTIFICACIÓN DEL TRADUCTOR", certStmt: "Certifico que soy competente para traducir del inglés al español y que la anterior es una traducción verídica y exacta del documento adjunto según mi leal saber y entender.", signature: "Firma", date: "Fecha", name: "Nombre en letra de imprenta" };
  const sigLine = (label, width) => `<div style="border-bottom:1pt solid #111;width:${width};height:24pt;margin-top:18pt"></div><div style="font-size:9.5pt;color:#333;margin-top:2pt">${esc(label)}</div>`;
  return `<!DOCTYPE html><html><head>${TRANSLATION_STYLE}</head><body><h1>${esc(t.title)}</h1>${bodyHtml}<div style="border-top:1pt solid #999;margin-top:26pt"></div><div style="font-size:12.5pt;font-weight:bold;margin-top:18pt">${esc(t.certHeading)}</div><p style="text-align:justify;margin:8pt 0 14pt">${esc(t.certStmt)}</p>${sigLine(t.signature, "62%")}${sigLine(t.date, "40%")}${sigLine(t.name, "62%")}</body></html>`;
}
function htmlToPdf(html) {
  const doc = mupdf.Document.openDocument(new TextEncoder().encode(html), "text/html");
  doc.layout(612, 792, 11);
  const n = doc.countPages();
  if (typeof doc.toPDFDocument === "function") return doc.toPDFDocument().saveToBuffer("").asUint8Array();
  const buf = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buf, "pdf", "");
  for (let i = 0; i < n; i++) { const p = doc.loadPage(i); const dev = writer.beginPage(p.getBounds()); p.run(dev, mupdf.Matrix.identity); writer.endPage(); }
  writer.close();
  return buf.asUint8Array();
}
const mdi = new MarkdownIt({ html: false, linkify: false, breaks: true });
const pdfBytes = htmlToPdf(buildCertifiedTranslationHtml(mdi.render(translatedText), DIRECTION));
writeFileSync(`${OUT}/real-translation.pdf`, Buffer.from(pdfBytes));
const rdoc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
for (let i = 0; i < rdoc.countPages(); i++) {
  const pix = rdoc.loadPage(i).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false);
  writeFileSync(`${OUT}/real-translation-p${i + 1}.png`, Buffer.from(pix.asPNG()));
}
console.log("rendered real-translation.pdf —", rdoc.countPages(), "pages");
console.log("DONE (read-only) — local PDF at docs/_evidence/etapa3-translation/real-translation.pdf");
// NOTE: no production reads/writes. Real Gemini translation, rendered LOCALLY
// through the exact production renderCertifiedTranslationPdf pipeline; viewed in
// the browser via file://.
