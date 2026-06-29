/**
 * Faithful replication of platform/pdf.ts renderCertifiedTranslationPdf
 * (buildCertifiedTranslationHtml + htmlToPdf, mupdf html→pdf) for a sample
 * translated body, so we can VISUALLY confirm the certified-translation document:
 * title "CERTIFIED ENGLISH TRANSLATION", readable hierarchy/spacing, and the
 * translator's certification block with signature lines.
 *
 * Usage: node docs/_evidence/etapa3-translation/render-sample.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import MarkdownIt from "markdown-it";
import * as mupdf from "mupdf";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/etapa3-translation`;
mkdirSync(OUT, { recursive: true });

// --- verbatim copy of TRANSLATION_STYLE + buildCertifiedTranslationHtml (pdf.ts) ---
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

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function buildCertifiedTranslationHtml(bodyHtml, direction) {
  const toEnglish = direction === "es-en";
  const t = toEnglish
    ? {
        title: "CERTIFIED ENGLISH TRANSLATION",
        certHeading: "TRANSLATOR'S CERTIFICATION",
        certStmt:
          "I certify that I am competent to translate from Spanish to English and that the above is a true and accurate translation of the attached document to the best of my knowledge and ability.",
        signature: "Signature",
        date: "Date",
        name: "Printed name",
      }
    : {
        title: "TRADUCCIÓN CERTIFICADA AL ESPAÑOL",
        certHeading: "CERTIFICACIÓN DEL TRADUCTOR",
        certStmt:
          "Certifico que soy competente para traducir del inglés al español y que la anterior es una traducción verídica y exacta del documento adjunto según mi leal saber y entender.",
        signature: "Firma",
        date: "Fecha",
        name: "Nombre en letra de imprenta",
      };
  const sigLine = (label, width) =>
    `<div style="border-bottom:1pt solid #111;width:${width};height:24pt;margin-top:18pt"></div>` +
    `<div style="font-size:9.5pt;color:#333;margin-top:2pt">${esc(label)}</div>`;
  return (
    `<!DOCTYPE html><html><head>${TRANSLATION_STYLE}</head><body>` +
    `<h1>${esc(t.title)}</h1>` +
    bodyHtml +
    `<div style="border-top:1pt solid #999;margin-top:26pt"></div>` +
    `<div style="font-size:12.5pt;font-weight:bold;margin-top:18pt">${esc(t.certHeading)}</div>` +
    `<p style="text-align:justify;margin:8pt 0 14pt">${esc(t.certStmt)}</p>` +
    sigLine(t.signature, "62%") +
    sigLine(t.date, "40%") +
    sigLine(t.name, "62%") +
    `</body></html>`
  );
}

function htmlToPdf(html) {
  const doc = mupdf.Document.openDocument(new TextEncoder().encode(html), "text/html");
  doc.layout(612, 792, 11);
  const n = doc.countPages();
  if (typeof doc.toPDFDocument === "function") {
    return doc.toPDFDocument().saveToBuffer("").asUint8Array();
  }
  const buf = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buf, "pdf", "");
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const dev = writer.beginPage(page.getBounds());
    page.run(dev, mupdf.Matrix.identity);
    writer.endPage();
  }
  writer.close();
  return buf.asUint8Array();
}

// --- sample translated body (Markdown, as Gemini now returns it) ---
const sampleMarkdown = `# Birth Certificate

**Civil Registry of Bogotá, D.C. — Republic of Colombia**

This document certifies that **Juan Esteban Pérez Gómez** was born on **June 15, 1990**, in the city of Bogotá, Capital District.

## Personal Information

- **Full name:** Juan Esteban Pérez Gómez
- **Date of birth:** June 15, 1990
- **Place of birth:** Bogotá, D.C., Colombia
- **Sex:** Male

## Parents

| Relationship | Name | Nationality |
|---|---|---|
| Father | Carlos Alberto Pérez | Colombian |
| Mother | María Esperanza Gómez | Colombian |

## Registry Data

The present record was entered under **registration number 1234567**, book 05, page 210, on **January 10, 2020**. Issued by the Registrar's Office of the Capital District.`;

const mdi = new MarkdownIt({ html: false, linkify: false });
const bodyHtml = mdi.render(sampleMarkdown);
const html = buildCertifiedTranslationHtml(bodyHtml, "es-en");
const pdf = htmlToPdf(html);
writeFileSync(`${OUT}/translation-sample.pdf`, Buffer.from(pdf));
console.log("wrote translation-sample.pdf", pdf.length, "bytes");

// render each page to PNG
const doc = mupdf.Document.openDocument(pdf, "application/pdf");
const n = doc.countPages();
const scale = mupdf.Matrix.scale(2, 2);
for (let i = 0; i < n; i++) {
  const pix = doc.loadPage(i).toPixmap(scale, mupdf.ColorSpace.DeviceRGB, false);
  writeFileSync(`${OUT}/translation-sample-p${i + 1}.png`, Buffer.from(pix.asPNG()));
  console.log("wrote translation-sample-p" + (i + 1) + ".png");
}
console.log("pages:", n);
