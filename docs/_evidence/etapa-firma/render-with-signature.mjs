/**
 * Evidence (read-only): full NEW certified-translation render — real Gemini
 * translation of a realistic Spanish birth registry (new prompt with label-value
 * TABLES) + the new buildCertifiedTranslationHtml (global directional title,
 * document title, cert "I, {name}, hereby certify…") + a STAMPED signature image.
 * Replicates src/backend/platform/pdf.ts verbatim. No prod writes.
 *
 * Usage: node docs/_evidence/etapa-firma/render-with-signature.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import MarkdownIt from "markdown-it";
import * as mupdf from "mupdf";
import { GoogleGenAI } from "@google/genai";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/etapa-firma`;
mkdirSync(OUT, { recursive: true });
const M = mupdf;

const env = (k) => (readFileSync(`${ROOT}/.env.local`, "utf8").match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const MODEL = env("AI_GEMINI_MODEL") || "gemini-2.5-flash";

const SIGNER = "Andrew Sonny Navarro";

// --- realistic Spanish source with label-value data (like the reference model) ---
const sourceText = `REGISTRO CIVIL DE BOGOTÁ, D.C. — REPÚBLICA DE COLOMBIA
ACTA DE INSCRIPCIÓN DE NACIMIENTO

Número de inscripción: N-060-000112-18
Número de documento de identidad: 1750488890

En Bogotá, Distrito Capital, el 21 de septiembre de 2010, el suscrito Jefe del Registro Civil expide la presente inscripción de nacimiento para:

Nombres: Crystel Fabiana
Apellidos: Defaz González
Sexo: Femenino
Lugar y fecha de nacimiento: Bogotá, D.C., Colombia, el 18 de julio de 2010.
Padre: Diego Iván Defaz Arteaga, documento No. 1716384415, nacionalidad colombiana, estado civil soltero.
Madre: Diana Carolina González Barrera, documento No. 1720905957, nacionalidad colombiana, estado civil soltera.

OBSERVACIONES
Los padres comparecen y solicitan la inscripción. Padres solteros. Hospital G.O.I.A., Dr. Michael Veintimilla; Código: 9855.`;

// --- new prompt (label-value TABLES) ---
const formatGuidance =
  " Format the result as clean Markdown that mirrors the source so it reads clearly: use a level-1 heading (#) for the document's own title and level-2 headings (##) for sections; write a 2-COLUMN Markdown table (| Field | Detail |) for blocks of label-value data (registry fields such as 'Given names', 'Date of birth', 'Father', 'Registration number'), and prose paragraphs for narrative text; keep line breaks and lists. Preserve names, numbers and dates exactly. Do not add notes or commentary, and do not wrap the answer in a code fence.";
const promptText =
  "Translate the following document from Spanish to English. Be faithful and do not summarize. Preserve names, numbers and dates exactly. Mark illegible text as [illegible]." +
  formatGuidance;

function stripMarkdownFence(text) { const t = text.trim(); const m = /^```[a-zA-Z0-9]*\n([\s\S]*?)\n?```$/.exec(t); return m ? m[1].trim() : t; }
let translatedText;
const cache = `${OUT}/_cache.md`;
try { translatedText = readFileSync(cache, "utf8"); console.log("(using cached translation)"); } catch {
  const genai = new GoogleGenAI({ apiKey: env("GEMINI_API_KEY") });
  const resp = await genai.models.generateContent({ model: MODEL, contents: [{ role: "user", parts: [{ text: `${promptText}\n\n---\n${sourceText}` }] }], config: { temperature: 0.2, maxOutputTokens: 65536 } });
  translatedText = stripMarkdownFence(resp.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  writeFileSync(cache, translatedText);
}
console.log("--- translated markdown ---\n" + translatedText + "\n---");

// ====== verbatim copy of src/backend/platform/pdf.ts (F section) ======
const SIGNATURE_ANCHOR = "XULPSIGNATUREANCHORX";
const TRANSLATION_STYLE = `<style>
  body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5;margin:64pt 72pt;color:#111}
  .xt-global-title{font-size:18pt;text-align:center;font-weight:bold;letter-spacing:1pt;text-transform:uppercase;margin:0 0 6pt;line-height:1.25}
  .xt-global-rule{width:44%;margin:0 auto 18pt;border:none;border-top:1.4pt solid #111}
  h1{font-size:14pt;text-align:center;font-weight:bold;margin:0 0 14pt;line-height:1.3}
  h2{font-size:12.5pt;font-weight:bold;letter-spacing:.3pt;margin:15pt 0 6pt}
  h3{font-size:12pt;font-weight:bold;margin:12pt 0 5pt}
  h4{font-size:11.5pt;font-weight:bold;margin:10pt 0 4pt}
  p{margin:0 0 9pt;text-align:justify}
  ul,ol{margin:0 0 9pt 0;padding-left:22pt}
  li{margin:0 0 4pt 0}
  table{border-collapse:collapse;width:100%;margin:7pt 0 13pt;table-layout:fixed}
  th,td{border:0.5pt solid #bbb;padding:4pt 8pt;text-align:left;vertical-align:top;word-break:break-word}
  th{background:#eee;font-weight:bold}
  th:first-child,td:first-child{font-weight:bold;width:170pt}
  a{color:#111;text-decoration:none}
  .xt-cert-heading{font-size:12.5pt;font-weight:bold;letter-spacing:.3pt;margin:26pt 0 0;border-top:1pt solid #999;padding-top:12pt}
  .xt-cert-stmt{text-align:justify;margin:8pt 0 16pt}
  .xt-sig-label{font-weight:bold}
  .xt-sig-anchor{color:#fff;font-size:1pt}
  .xt-sig-line{margin:16pt 0 0}
  .xt-sig-space{height:52pt}
  .xt-sig-date{margin:0;font-size:11pt}
</style>`;
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function buildCertifiedTranslationHtml(bodyHtml, direction, opts = {}) {
  const name = opts.signerName?.trim() || ""; const date = opts.signedDate?.trim() || "";
  const t = {
    globalTitle: "CERTIFIED TRANSLATION FROM SPANISH TO ENGLISH",
    certHeading: "TRANSLATION CERTIFICATION",
    certStmt: name
      ? `I, ${esc(name)}, hereby certify that I translated the attached document from Spanish into English and that, to the best of my ability, it is a true and correct translation. I further certify that I am competent in both Spanish and English to render and certify such translation.`
      : "I hereby certify that the attached document was translated from Spanish into English and that, to the best of my ability, it is a true and correct translation, rendered by a person competent in both Spanish and English.",
    signature: "Signature:", date: "Date:",
  };
  return `<!DOCTYPE html><html><head>${TRANSLATION_STYLE}</head><body>` +
    `<div class="xt-global-title">${esc(t.globalTitle)}</div>` +
    `<hr class="xt-global-rule"/>` + bodyHtml +
    `<div class="xt-cert-heading">${esc(t.certHeading)}</div>` +
    `<p class="xt-cert-stmt">${t.certStmt}</p>` +
    `<p class="xt-sig-line"><span class="xt-sig-label">${esc(t.signature)}</span> <span class="xt-sig-anchor">${SIGNATURE_ANCHOR}</span></p>` +
    `<div class="xt-sig-space"></div>` +
    `<p class="xt-sig-date">${esc(t.date)} ${esc(date)}</p></body></html>`;
}
function htmlToPdf(html) { const doc = M.Document.openDocument(new TextEncoder().encode(html), "text/html"); doc.layout(612, 792, 11); const n = doc.countPages(); if (typeof doc.toPDFDocument === "function") return doc.toPDFDocument().saveToBuffer("").asUint8Array(); const b = new M.Buffer(); const w = new M.DocumentWriter(b, "pdf", ""); for (let i = 0; i < n; i++) { const p = doc.loadPage(i); const d = w.beginPage(p.getBounds()); p.run(d, M.Matrix.identity); w.endPage(); } w.close(); return b.asUint8Array(); }
function quadToRect(q) { if (Array.isArray(q) && typeof q[0] === "number") { if (q.length >= 8) return { x0: Math.min(q[0], q[4]), y0: Math.min(q[1], q[3]), x1: Math.max(q[2], q[6]), y1: Math.max(q[5], q[7]) }; if (q.length === 4) return { x0: q[0], y0: q[1], x1: q[2], y1: q[3] }; } if (q?.ul && q?.lr) return { x0: q.ul.x, y0: q.ul.y, x1: q.lr.x, y1: q.lr.y }; return null; }
function stampSignatureOnPdf(pdfBytes, imageBytes) {
  const src = M.Document.openDocument(pdfBytes, "application/pdf");
  const image = new M.Image(imageBytes); const iw = image.getWidth(), ih = image.getHeight();
  const maxW = 165, maxH = 48; let drawW = maxW, drawH = maxW * ih / iw; if (drawH > maxH) { drawH = maxH; drawW = maxH * iw / ih; }
  const n = src.countPages(); let target = null;
  for (let i = 0; i < n && !target; i++) { const st = src.loadPage(i).toStructuredText("preserve-whitespace"); let hits; try { hits = st.search(SIGNATURE_ANCHOR); } catch { hits = null; } if (Array.isArray(hits) && hits.length) { let q = hits[0]; while (Array.isArray(q) && Array.isArray(q[0])) q = q[0]; const r = quadToRect(q); if (r) target = { page: i, x: r.x1 + 4, y: r.y0 - 2 }; } }
  if (!target) return pdfBytes;
  const buf = new M.Buffer(); const writer = new M.DocumentWriter(buf, "pdf", "");
  for (let i = 0; i < n; i++) { const p = src.loadPage(i); const d = writer.beginPage(p.getBounds()); p.run(d, M.Matrix.identity); if (i === target.page) d.fillImage(image, [drawW, 0, 0, drawH, target.x, target.y], 1); writer.endPage(); }
  writer.close(); return buf.asUint8Array();
}
// ====== end verbatim copy ======

// a realistic cursive "signature" image (transparent-ish), via html->pdf->pixmap->png
function makeSignaturePng() {
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0"><div style="font:italic 34pt 'Brush Script MT','Segoe Script',cursive;color:#101a4a">${SIGNER}</div></body></html>`;
  const d = M.Document.openDocument(new TextEncoder().encode(html), "text/html"); d.layout(360, 70, 11);
  return d.loadPage(0).toPixmap(M.Matrix.scale(2, 2), M.ColorSpace.DeviceRGB, false).asPNG();
}
const sigPng = makeSignaturePng();
writeFileSync(`${OUT}/signature.png`, Buffer.from(sigPng));

const mdi = new MarkdownIt({ html: false, linkify: false, breaks: true });
const baseHtml = buildCertifiedTranslationHtml(mdi.render(translatedText), "es-en", { signerName: SIGNER, signedDate: "29 June 2026" });
let pdf = htmlToPdf(baseHtml);
pdf = stampSignatureOnPdf(pdf, sigPng);
writeFileSync(`${OUT}/translation-signed.pdf`, Buffer.from(pdf));
const rdoc = M.Document.openDocument(pdf, "application/pdf");
for (let i = 0; i < rdoc.countPages(); i++) { const px = rdoc.loadPage(i).toPixmap(M.Matrix.scale(2, 2), M.ColorSpace.DeviceRGB, false); writeFileSync(`${OUT}/translation-signed-p${i + 1}.png`, Buffer.from(px.asPNG())); }
console.log("wrote translation-signed.pdf —", rdoc.countPages(), "pages");
