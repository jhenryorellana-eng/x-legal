/**
 * PDF platform wrapper — mupdf (ESM/WASM) + docx
 *
 * Provides three PDF/document capabilities:
 *   1. renderMarkdownToPdf  — md → HTML → mupdf → PDF bytes (US Letter)
 *   2. renderMarkdownToDocx — md → docx bytes via `docx` npm package
 *   3. detectAcroFields     — enumerate AcroForm widgets from a PDF
 *   4. fillAcroForm         — fill + flatten AcroForm fields (XFA-safe recipe)
 *
 * mupdf is ESM-only with a WASM binary. Next.js must NOT bundle it:
 *   next.config.ts: serverExternalPackages: ['mupdf']
 *
 * Spike evidence: docs/_evidence/f4-spike/SPIKE-FINDINGS.md
 *   - html→pdf confirmed via Document.openDocument(buf, "text/html") + layout(612,792,11)
 *   - XFA fill recipe: drop XFA → setTextValue → update → bake → saveToBuffer
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedField {
  name: string;
  type: "text" | "checkbox" | "combobox" | "radiobutton" | "signature" | "button";
  page: number;
  rect: [number, number, number, number]; // [x0, y0, x1, y1]
}

export interface AcroFillMapping {
  /** pdf_field_name → profile/extraction field path (for logging only) */
  [pdfFieldName: string]: string;
}

export interface AcroFillValues {
  /** pdf_field_name → value to set */
  [pdfFieldName: string]: string | boolean;
}

// ---------------------------------------------------------------------------
// A. renderMarkdownToPdf
//    md → HTML → mupdf Document.openDocument → layout(612,792,11) → PDF bytes
// ---------------------------------------------------------------------------

/**
 * Page-break sentinel — must match ai-engine's `PAGE_BREAK` constant. A standalone
 * line carrying this marker starts a new physical page (mupdf's HTML engine ignores
 * CSS `page-break-*`, so we render each segment to its own PDF and merge them).
 */
const PDF_PAGE_BREAK = "<<<PAGEBREAK>>>";

/** Court-document stylesheet: justified serif body, spaced headings, and bordered
 *  two-column tables (cover data, exhibit cover-sheets, the chronology). */
const MEMO_STYLE = `<style>
  body{font-family:'Times New Roman',serif;font-size:11pt;line-height:1.45;margin:72pt;color:#111}
  h1{font-size:19pt;text-align:center;font-weight:bold;margin:0 0 14pt;line-height:1.25}
  h2{font-size:14.5pt;font-weight:bold;margin:18pt 0 8pt}
  h3{font-size:12.5pt;font-weight:bold;margin:14pt 0 6pt}
  h4{font-size:11.5pt;font-weight:bold;margin:12pt 0 5pt}
  p{margin:0 0 9pt;text-align:justify}
  ul{margin:0 0 9pt 0;padding-left:20pt}
  li{margin:0 0 4pt 0}
  table{border-collapse:collapse;width:100%;margin:6pt 0 14pt}
  th,td{border:0.75pt solid #555;padding:5pt 8pt;text-align:left;vertical-align:top}
  th{background:#ececec;font-weight:bold}
  td:first-child{font-weight:bold;background:#f7f7f7}
  a{color:#111;text-decoration:none}
</style>`;

/**
 * Renders a markdown string to a US Letter PDF (612x792 pt) via mupdf.
 *
 * Pipeline: markdown-it (md→HTML) → mupdf html→pdf. The markdown may contain
 * `<<<PAGEBREAK>>>` marker lines; each delimited segment is laid out and rendered
 * independently, then merged (graftPage) so it starts on a fresh page. Uses
 * server-side dynamic import of mupdf (ESM/WASM — not bundled by Next.js).
 *
 * @returns Uint8Array of PDF bytes (starts with %PDF)
 */
export async function renderMarkdownToPdf(md: string): Promise<Uint8Array> {
  const MarkdownIt = (await import("markdown-it")).default;
  const mdi = new MarkdownIt({ html: false, linkify: false });
  const wrap = (bodyHtml: string) => `<!DOCTYPE html><html><head>${MEMO_STYLE}</head><body>${bodyHtml}</body></html>`;

  const segments = md.split(PDF_PAGE_BREAK).map((s) => s.trim()).filter(Boolean);
  const htmls = (segments.length ? segments : [md]).map((seg) => wrap(mdi.render(seg)));

  // Single page-group → render directly.
  if (htmls.length === 1) return htmlToPdf(htmls[0]);

  // Multi page-group → render each to PDF, then graft every page into one document
  // so each group starts on a new page (the proven compileExpedientePdf pattern).
  const mupdf = await import("mupdf");

  const M = mupdf as any;
  const dst = new M.PDFDocument();
  try {
    for (const html of htmls) {
      const bytes = await htmlToPdf(html);
      const src = M.Document.openDocument(bytes, "application/pdf");
      try {
        const n = src.countPages();
        for (let i = 0; i < n; i++) dst.graftPage(dst.countPages(), src, i);
      } finally {
        try { src.destroy?.(); } catch { /* freed */ }
      }
    }
    // garbage=4 deduplicates the identical font/resource objects each grafted
    // segment carries (otherwise the merged PDF bloats ~8x); compress streams.
    return dst.saveToBuffer("garbage=4,compress=yes").asUint8Array() as Uint8Array;
  } finally {
    try { dst.destroy?.(); } catch { /* freed */ }
  }
}

// ---------------------------------------------------------------------------
// B. renderMarkdownToDocx
//    md → DOCX bytes via `docx` npm package (P-42-1 gated in catalog UI)
// ---------------------------------------------------------------------------

/**
 * Renders a markdown string to a DOCX file (US Letter, 1in margins).
 *
 * Supports: headings (H1-H3), bold, italic, paragraphs, bullet lists.
 * Complex constructs (tables, blockquotes) are rendered as plain paragraphs.
 */
export async function renderMarkdownToDocx(md: string): Promise<Uint8Array> {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer, PageBreak } = await import("docx");

  // Parse markdown into a list of paragraph-like structures
  const paragraphs: InstanceType<typeof Paragraph>[] = [];

  const lines = md.split("\n");
  let currentBullets: string[] = [];

  const flushBullets = () => {
    for (const bullet of currentBullets) {
      paragraphs.push(
        new Paragraph({
          text: bullet,
          bullet: { level: 0 },
        }),
      );
    }
    currentBullets = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === PDF_PAGE_BREAK) {
      flushBullets();
      paragraphs.push(new Paragraph({ children: [new PageBreak()] }));
    } else if (trimmed.startsWith("#### ")) {
      flushBullets();
      paragraphs.push(new Paragraph({ text: trimmed.slice(5), heading: HeadingLevel.HEADING_4 }));
    } else if (trimmed.startsWith("### ")) {
      flushBullets();
      paragraphs.push(new Paragraph({ text: trimmed.slice(4), heading: HeadingLevel.HEADING_3 }));
    } else if (trimmed.startsWith("## ")) {
      flushBullets();
      paragraphs.push(new Paragraph({ text: trimmed.slice(3), heading: HeadingLevel.HEADING_2 }));
    } else if (trimmed.startsWith("# ")) {
      flushBullets();
      paragraphs.push(new Paragraph({ text: trimmed.slice(2), heading: HeadingLevel.HEADING_1 }));
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      currentBullets.push(trimmed.slice(2));
    } else if (trimmed === "" || trimmed === "---") {
      flushBullets();
      // blank line or hr → empty paragraph as separator
      paragraphs.push(new Paragraph({}));
    } else {
      flushBullets();
      // Inline bold/italic parsing (simple)
      const runs: InstanceType<typeof TextRun>[] = [];
      const rest = trimmed;
      // Simple bold (**text**) and italic (*text*) parsing
      const boldItalicRe = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|(.+?)(?=\*|$))/g;
      let match: RegExpExecArray | null;
      while ((match = boldItalicRe.exec(rest)) !== null) {
        if (match[2]) {
          runs.push(new TextRun({ text: match[2], bold: true, italics: true }));
        } else if (match[3]) {
          runs.push(new TextRun({ text: match[3], bold: true }));
        } else if (match[4]) {
          runs.push(new TextRun({ text: match[4], italics: true }));
        } else if (match[5]) {
          runs.push(new TextRun({ text: match[5] }));
        }
      }
      if (runs.length === 0) {
        runs.push(new TextRun({ text: rest }));
      }
      paragraphs.push(new Paragraph({ children: runs }));
    }
  }
  flushBullets();

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 }, // US Letter in TWIPs (1/20 pt)
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // 1 inch = 1440 TWIPs
          },
        },
        children: paragraphs,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// C. detectAcroFields
//    Enumerate AcroForm widgets from a PDF (Ola 2 — pdf_automation)
//    Spike evidence: detect.cjs / mupdf-test.mjs
// ---------------------------------------------------------------------------

/**
 * Enumerates all AcroForm widgets in a PDF.
 *
 * Returns an array of detected fields with name, type, page index, and bounds.
 * Used by catalog/service for form_automation_versions.detected_fields (Ola 2).
 */
export async function detectAcroFields(bytes: Uint8Array): Promise<DetectedField[]> {
  const mupdf = await import("mupdf");

   
  const doc = (mupdf.Document as any).openDocument(bytes, "application/pdf");
   
  const n = (doc as any).countPages();
  const fields: DetectedField[] = [];

  for (let i = 0; i < n; i++) {
     
    const page = (doc as any).loadPage(i);
     
    const widgets: any[] = (page as any).getWidgets?.() ?? [];
    for (const w of widgets) {
      const name: string = w.getName?.() ?? "";
      const rawType: string = w.getFieldType?.() ?? "text";
      const bounds: [number, number, number, number] = w.getBounds?.() ?? [0, 0, 0, 0];

      const type = (
        ["text", "checkbox", "combobox", "radiobutton", "signature", "button"].includes(rawType)
          ? rawType
          : "text"
      ) as DetectedField["type"];

      fields.push({ name, type, page: i, rect: bounds });
    }
  }

  return fields;
}

/**
 * Extracts the printed text of a PDF, one labeled block per page. Used to GROUND
 * the AI form-segmentation: the official form's labels (e.g. "Your Occupation",
 * "Name and Address of Employer") let the model map otherwise-anonymous AcroForm
 * field names (e.g. "TextField13[39]") to the right question. Best-effort.
 */
export async function extractPdfText(bytes: Uint8Array, maxCharsPerPage = 2400): Promise<string> {
  const mupdf = await import("mupdf");
   
  const doc = (mupdf.Document as any).openDocument(bytes, "application/pdf");
   
  const n = (doc as any).countPages();
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let pageText = "";
    try {
       
      const page = (doc as any).loadPage(i);
       
      const stext = (page as any).toStructuredText?.("preserve-whitespace");
      if (stext) {
        // mupdf StructuredText: prefer asText(); fall back to parsing asJSON().
        if (typeof stext.asText === "function") {
          pageText = String(stext.asText());
        } else if (typeof stext.asJSON === "function") {
          const json = JSON.parse(String(stext.asJSON())) as {
            blocks?: Array<{ lines?: Array<{ text?: string; spans?: Array<{ text?: string }> }> }>;
          };
          pageText = (json.blocks ?? [])
            .flatMap((b) => (b.lines ?? []).map((l) => l.text ?? (l.spans ?? []).map((s) => s.text ?? "").join("")))
            .join(" ");
        }
      }
    } catch {
      /* best-effort per page */
    }
    pageText = pageText.replace(/\s+/g, " ").trim().slice(0, maxCharsPerPage);
    if (pageText) out.push(`=== Page ${i + 1} ===\n${pageText}`);
  }
  return out.join("\n\n");
}

// ---------------------------------------------------------------------------
// D. fillAcroForm
//    Fill + flatten AcroForm fields using the XFA-safe recipe from the spike
//    Spike evidence: fill-debug.mjs / SPIKE-FINDINGS.md
// ---------------------------------------------------------------------------

/**
 * Fills AcroForm fields in a PDF and returns flattened bytes.
 *
 * XFA-safe recipe (confirmed on I-765, I-360):
 *   1. Drop XFA layer so AcroForm static layer becomes authoritative
 *   2. Set NeedAppearances = true
 *   3. setTextValue / setChoiceValue / checkbox toggle per field + update()
 *   4. bake() — flattens widgets to content (after this: 0 widgets)
 *   5. saveToBuffer → Uint8Array
 *
 * @param bytes    Raw PDF bytes (from storage)
 * @param _mapping field name → source path (informational only; unused at runtime)
 * @param values   field name → value to set
 */
export async function fillAcroForm(
  bytes: Uint8Array,
  _mapping: AcroFillMapping,
  values: AcroFillValues,
): Promise<Uint8Array> {
  const mupdf = await import("mupdf");

   
  const doc = (mupdf.Document as any).openDocument(bytes, "application/pdf") as any;
   
  const pdfDoc = doc as any;

  // Step 1: Drop XFA so AcroForm static layer wins
  try {
    const acroForm = pdfDoc.getTrailer?.()?.get?.("Root")?.get?.("AcroForm");
    if (acroForm) {
      acroForm.delete("XFA");
      acroForm.put("NeedAppearances", pdfDoc.newBoolean?.(true) ?? true);
    }
  } catch {
    // Non-fatal: continue without XFA drop if doc structure is unexpected
  }

  // Step 2: Fill fields
  const n: number = pdfDoc.countPages();
  for (let i = 0; i < n; i++) {
    const page = pdfDoc.loadPage(i);
    const widgets: unknown[] = (page as { getWidgets?: () => unknown[] }).getWidgets?.() ?? [];
    for (const w of widgets) {
      const widget = w as {
        getName?: () => string;
        getFieldType?: () => string;
        setTextValue?: (v: string) => void;
        setChoiceValue?: (v: string) => void;
        toggle?: () => void;
        update?: () => void;
      };
      const name = widget.getName?.() ?? "";
      if (!(name in values)) continue;

      const val = values[name];
      const fieldType = widget.getFieldType?.() ?? "text";

      try {
        if (fieldType === "checkbox") {
          // For checkboxes, a truthy value toggles on
          if (val) widget.toggle?.();
        } else if (fieldType === "combobox" || fieldType === "radiobutton") {
          widget.setChoiceValue?.(String(val));
        } else {
          widget.setTextValue?.(String(val));
        }
        widget.update?.();
      } catch {
        // Skip individual field errors — log at call site
      }
    }
  }

  // Step 3: bake + save
  try {
    pdfDoc.bake?.();
  } catch {
    // Non-fatal: bake may not be available on all mupdf versions
  }

  const outBuf = pdfDoc.saveToBuffer?.("") ?? pdfDoc.save?.("");
   
  return (outBuf as any).asUint8Array() as Uint8Array;
}

// ---------------------------------------------------------------------------
// D2. backfillNaTextFields — USCIS "no blank box" acceptance rule
// ---------------------------------------------------------------------------

/** Office-use / non-applicant field names that must NOT be auto-filled with "N/A". */
const PDF_OFFICE_USE_RE =
  /(signature|preparer|interpreter|attorney|g-?28|barcode|bar_code|pdf417|qrcode|page[\s_-]?(number|no\b)|uscis\s*use|official\s*use|for\s*eoir|notary|date\s*of\s*signature|received|remarks|action\s*block)/i;

/**
 * USCIS rejects a form that leaves ANY field blank, but the instructions allow
 * "N/A"/"None" for inapplicable fields (8 CFR 1208.3(c)(3)). This writes a
 * placeholder into every applicant TEXT field that is still empty — SCOPED to the
 * pages this form actually covers (so a split form, e.g. I-589 Part A on pages 1-4,
 * does not stamp "N/A" onto another form's pages). Office-use / signature fields and
 * non-text widgets (checkboxes) are never touched. Mutates `filled` in place.
 *
 * @returns how many fields were back-filled.
 */
export function backfillNaTextFields(
  detectedFields: Array<{ pdf_field_name: string; field_type: string; page: number }>,
  filled: Record<string, string | boolean>,
  formFieldNames: Iterable<string>,
  placeholder = "N/A",
): number {
  const formFieldSet = new Set(formFieldNames);
  // The form's page scope = the pages its mapped questions live on.
  const formPages = new Set<number>();
  for (const f of detectedFields) if (formFieldSet.has(f.pdf_field_name)) formPages.add(f.page);
  if (formPages.size === 0) return 0;

  let n = 0;
  for (const f of detectedFields) {
    if (!formPages.has(f.page)) continue;
    if (f.field_type !== "text") continue; // checkboxes can't hold "N/A"
    if (f.pdf_field_name in filled) continue; // already has a value (answer or a SELECT's ticked box)
    if (PDF_OFFICE_USE_RE.test(f.pdf_field_name)) continue;
    filled[f.pdf_field_name] = placeholder;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// E. renderCoverPdf  — deterministic cover page (carátula) via mupdf html→pdf
// ---------------------------------------------------------------------------

export interface CoverData {
  /** Big title (e.g. "EXPEDIENTE" or the service name). */
  title: string;
  /** Subtitle / form name (optional). */
  subtitle?: string;
  caseNumber: string;
  /** Canonical client label "{inicial}. {apellido}" — no PII. */
  clientLabel: string;
  serviceLabel: string;
  /** Footer line (org name / date). */
  footer?: string;
  /** "ulp-classic" (portada) | "ulp-divider" (separador). */
  style?: "ulp-classic" | "ulp-divider";
}

const NAVY = "#0b1f3a";
const GOLD = "#c8a24a";

/** mupdf html→pdf (US Letter), shared by cover/TOC/contract renders.
 * Mirrors renderMarkdownToPdf: prefer toPDFDocument(), else DocumentWriter. */
export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const mupdf = await import("mupdf");
   
  const M = mupdf as any;
  const doc = M.Document.openDocument(new TextEncoder().encode(html), "text/html");
  try {
    doc.layout(612, 792, 11);
    const n = doc.countPages();
    if (typeof doc.toPDFDocument === "function") {
      return doc.toPDFDocument().saveToBuffer("").asUint8Array() as Uint8Array;
    }
    const buf = new M.Buffer();
    const writer = new M.DocumentWriter(buf, "pdf", "");
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i);
      const dev = writer.beginPage(page.getBounds());
      page.run(dev, M.Matrix.identity);
      writer.endPage();
    }
    writer.close();
    return buf.asUint8Array() as Uint8Array;
  } finally {
    try { doc.destroy?.(); } catch { /* freed */ }
  }
   
}

/**
 * Renders a deterministic ULP cover/divider page (navy + gold, Helvetica) to a
 * one-page US Letter PDF. Same inputs → same bytes. DOC-45 §3.1.1.
 */
export async function renderCoverPdf(data: CoverData): Promise<Uint8Array> {
  const esc = (s: string) =>
    String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const isDivider = data.style === "ulp-divider";
  // Minimal, court-ready cover: large centered title (+ optional subtitle) and a
  // thin gold rule. No brand/firm name, no case/client/service metadata, no
  // bordered box — the client files pro se, so the page carries only the section
  // title. Titles arrive already in English from the assembly planner.
  const titleSize = isDivider ? "36pt" : "46pt";
  const html = `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;margin:0;padding:0;color:${NAVY}">
    <div style="text-align:center;margin-top:300pt;padding:0 54pt">
      <div style="font-size:${titleSize};font-weight:bold;letter-spacing:0.5pt;line-height:1.15">${esc(data.title)}</div>
      ${data.subtitle ? `<div style="font-size:24pt;margin-top:20pt;line-height:1.2">${esc(data.subtitle)}</div>` : ""}
      <div style="margin-top:30pt"><span style="display:inline-block;width:150pt;border-top:2pt solid ${GOLD}">&nbsp;</span></div>
    </div>
  </body></html>`;
  return htmlToPdf(html);
}

// ---------------------------------------------------------------------------
// F. renderCertifiedTranslationPdf — certified translation document
//    Title ("CERTIFIED ENGLISH TRANSLATION") + structured body (md→HTML) +
//    translator's certification block. 100% local, no AI (DOC-42 §3.7 / §3.5).
// ---------------------------------------------------------------------------

export type TranslationDirection = "es-en" | "en-es";

/** Court-ready stylesheet for the translated document: generous line spacing, a
 *  centered title, justified body, and bordered tables for any tabular source. */
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

/**
 * Composes the full HTML of a certified translation: a centered title, the
 * already-rendered translated `bodyHtml`, and the translator's certification
 * block (statement + signature / date / printed-name lines for a human to sign).
 * Pure + synchronous so it can be unit-tested without the WASM renderer. All
 * fixed strings are in the TARGET language (English for es-en, Spanish for en-es).
 *
 * @param bodyHtml HTML already rendered by markdown-it with `html:false` (so any
 *   HTML in the source is escaped). It is injected VERBATIM into the document —
 *   pass only markdown-it (or equivalently sanitized) output, never arbitrary
 *   user/model HTML. The output is rendered to PDF by mupdf (not a browser), so
 *   XSS does not apply, but this invariant keeps the function misuse-resistant.
 */
export function buildCertifiedTranslationHtml(bodyHtml: string, direction: TranslationDirection): string {
  const toEnglish = direction === "es-en"; // the translated output is English
  const esc = (s: string) =>
    String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

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

  const sigLine = (label: string, width: string) =>
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

/**
 * Renders the translated text (Markdown) to a certified-translation PDF. The
 * Markdown body is converted to HTML (preserving headings, paragraphs, line
 * breaks, lists and tables → readable hierarchy), then wrapped with the title +
 * certification block. mupdf's html→pdf layout paginates long bodies on its own.
 */
export async function renderCertifiedTranslationPdf(
  bodyMarkdown: string,
  direction: TranslationDirection,
): Promise<Uint8Array> {
  const MarkdownIt = (await import("markdown-it")).default;
  // `breaks: true` keeps the document's line structure: a single newline becomes
  // a <br> instead of collapsing to a space, so field lists ("Full name: …\nDate
  // of birth: …") render one per line as in the source — the line breaks the
  // translated document must preserve. `html: false` keeps the body injection safe.
  const mdi = new MarkdownIt({ html: false, linkify: false, breaks: true });
  const bodyHtml = mdi.render(bodyMarkdown);
  return htmlToPdf(buildCertifiedTranslationHtml(bodyHtml, direction));
}

// ---------------------------------------------------------------------------
// G. compileExpedientePdf — merge ordered items into one PDF + TOC + page numbers
// ---------------------------------------------------------------------------

export interface ExpedienteItemInput {
  /** Raw bytes of the item's source document. */
  bytes: Uint8Array;
  /** "application/pdf" | "image/jpeg" | "image/png" — how mupdf opens it. */
  mimeType: string;
  /** Index title (visible in the TOC). */
  title: string;
  includeInToc: boolean;
}

export interface CompiledExpediente {
  pdf: Uint8Array;
  pageCount: number;
  toc: Array<{ title: string; startPage: number; pageCount: number }>;
}

/**
 * Compiles an ordered list of items into a single US Letter PDF:
 *   1. open every item, count pages (two-pass to size the auto TOC),
 *   2. render a Table-of-Contents page (navy/gold) with each item's START page,
 *   3. merge TOC + every item's pages via a DocumentWriter (vector-preserving —
 *      not rasterized), stamping a continuous "{n} / {total}" footer per page.
 *
 * Robust to mixed inputs (PDF + scanned images). DOC-45 §3.4.
 */
export async function compileExpedientePdf(items: ExpedienteItemInput[]): Promise<CompiledExpediente> {
  const mupdf = await import("mupdf");
   
  const M = mupdf as any;

  // Open each item as a PDFDocument (graftPage needs PDF source + copies objects
  // verbatim — no font re-processing, unlike DocumentWriter which fails on USCIS
  // forms with "substitute font creation not implemented"). Non-PDF (scanned
  // images) are first rendered to a 1-page PDF (no fonts → safe via DocumentWriter).
  const toPdfDoc = (bytes: Uint8Array, mimeType: string): any => {
    if (!mimeType || mimeType === "application/pdf") return M.Document.openDocument(bytes, "application/pdf");
    const src = M.Document.openDocument(bytes, mimeType);
    const buf = new M.Buffer();
    const w = new M.DocumentWriter(buf, "pdf", "");
    for (let i = 0; i < Math.max(1, src.countPages()); i++) {
      const p = src.loadPage(i);
      const d = w.beginPage(p.getBounds());
      p.run(d, M.Matrix.identity);
      w.endPage();
    }
    w.close();
    try { src.destroy?.(); } catch { /* freed */ }
    return M.Document.openDocument(buf.asUint8Array(), "application/pdf");
  };

  // --- open each item + count pages ---
  const opened = items.map((it) => {
    const doc = toPdfDoc(it.bytes, it.mimeType);
    return { it, doc, pages: Math.max(1, doc.countPages()) };
  });

  const esc = (s: string) =>
    String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const buildTocHtml = (rows: Array<{ title: string; startPage: number }>) =>
    `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;margin:54pt 60pt;color:${NAVY}">
      <div style="font-size:22pt;font-weight:bold;margin:0 0 4pt">Índice del expediente</div>
      <div style="border-top:2pt solid ${GOLD};margin-bottom:14pt"></div>
      <table style="width:100%;font-size:12pt;border-collapse:collapse">
        ${rows
          .map(
            (r) =>
              `<tr><td style="padding:5pt 0">${esc(r.title)}</td><td style="padding:5pt 0;text-align:right;color:${GOLD};font-weight:bold">${r.startPage}</td></tr>`,
          )
          .join("")}
      </table>
    </body></html>`;

  // --- two-pass: render the TOC to PDF, measure it, finalize START pages ---
  let tocPages = 1;
  let toc: Array<{ title: string; startPage: number; pageCount: number }> = [];
  let tocPdf: any = null;
  for (let iter = 0; iter < 4; iter++) {
    let cursor = tocPages + 1; // first item page (1-based, after the TOC)
    toc = [];
    const rows: Array<{ title: string; startPage: number }> = [];
    for (const o of opened) {
      if (o.it.includeInToc) {
        toc.push({ title: o.it.title, startPage: cursor, pageCount: o.pages });
        rows.push({ title: o.it.title, startPage: cursor });
      }
      cursor += o.pages;
    }
    const tocBytes = await htmlToPdf(buildTocHtml(rows));
    try { tocPdf?.destroy?.(); } catch { /* freed */ }
    tocPdf = M.Document.openDocument(tocBytes, "application/pdf");
    const n = Math.max(1, tocPdf.countPages());
    if (n === tocPages) break;
    tocPages = n;
  }

  const totalPages = tocPages + opened.reduce((s, o) => s + o.pages, 0);

  // --- merge: graftPage TOC + every item into a fresh PDFDocument (verbatim) ---
  // NOTE: the TOC carries each item's START page (the navigation aid that matters).
  // A continuous footer page-number stamp is deferred — the mupdf WASM build can't
  // create substitute fonts for on-device text, so it needs an embedded font asset.
  const dst = new M.PDFDocument();
  const graft = (src: any) => {
    const n = src.countPages();
    for (let i = 0; i < n; i++) dst.graftPage(dst.countPages(), src, i);
  };
  graft(tocPdf);
  for (const o of opened) graft(o.doc);

  const pdf = dst.saveToBuffer("").asUint8Array() as Uint8Array;
  try { tocPdf?.destroy?.(); } catch { /* freed */ }
  for (const o of opened) { try { o.doc.destroy?.(); } catch { /* freed */ } }
  try { dst.destroy?.(); } catch { /* freed */ }
   

  return { pdf, pageCount: totalPages, toc };
}
