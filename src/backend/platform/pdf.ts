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
        getValue?: () => string;
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
          // Set an EXPLICIT on/off state (idempotent) instead of a blind toggle().
          // A blind flip is non-deterministic when a field has several kid widgets
          // that share one name (USCIS AcroForms do) and cannot turn a box OFF. We
          // read the current value ("Off"/"" = off) and toggle only when it differs
          // from the target — so N kids sharing a name converge to the same state and
          // a Yes/No · Sex · Marital group never ends up with BOTH boxes ticked.
          const wantOn = val === true || (typeof val === "string" && val !== "" && val !== "Off");
          const cur = widget.getValue?.() ?? "Off";
          const isOn = cur !== "Off" && cur !== "";
          if (isOn !== wantOn) widget.toggle?.();
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
 * placeholder into the caller-supplied set of **applicable, still-empty** applicant
 * TEXT fields — the questions that are VISIBLE (not hidden by a condition), not in a
 * do-not-fill section, and whose type holds free text. The caller decides what is
 * applicable; this helper only enforces the two hard rules USCIS/our engine share:
 * a placeholder never lands on a non-text widget (a checkbox can't hold "N/A") nor on
 * an office-use / signature field (`PDF_OFFICE_USE_RE`). Mutates `filled` in place.
 *
 * This is deliberately NOT a page-wide scan: a blind page scan stamped "N/A" onto
 * fields that belong to hidden blocks (spouse when single, unused child slots, Parts
 * F/G, the signature line), which is exactly what we must avoid.
 *
 * @param naTargets pdf_field_names of visible, applicable, empty text/textarea questions.
 * @returns how many fields were back-filled.
 */
export function backfillNaTextFields(
  detectedFields: Array<{ pdf_field_name: string; field_type: string; page: number }>,
  filled: Record<string, string | boolean>,
  naTargets: Iterable<string>,
  placeholder = "N/A",
): number {
  const typeByName = new Map(detectedFields.map((f) => [f.pdf_field_name, f.field_type]));
  let n = 0;
  for (const name of naTargets) {
    if (name in filled) continue; // already has a value (answer or a SELECT's ticked box)
    const detectedType = typeByName.get(name);
    if (detectedType !== undefined && detectedType !== "text") continue; // only text widgets hold "N/A"
    if (PDF_OFFICE_USE_RE.test(name)) continue;
    filled[name] = placeholder;
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
//    Global title (with the language direction) + the document's own title +
//    structured body (md→HTML, label-value tables) + a translator's certification
//    block carrying the configured signer name and a STAMPED signature image.
//    100% local, no AI (DOC-42 §3.7 / §3.5). Modeled on the reference
//    "Modelo de traduccion.pdf".
// ---------------------------------------------------------------------------

export type TranslationDirection = "es-en" | "en-es";

/** Optional per-service translation signing config + auto date, threaded from the
 *  job. `signatureImageBytes` (PNG/JPG) is STAMPED onto the PDF (mupdf cannot embed
 *  inline `<img>`), located via the invisible `SIGNATURE_ANCHOR` sentinel. */
export interface CertifiedTranslationOptions {
  signerName?: string | null;
  /** Pre-formatted date string for the "Date:" line (e.g. "29 June 2026"). */
  signedDate?: string | null;
  /** Encoded signature image to stamp on the signature line (PNG/JPG). */
  signatureImageBytes?: Uint8Array | null;
}

/** Invisible sentinel placed at the signature spot; `stampSignatureOnPdf` finds it
 *  via structured-text search and stamps the image there. Must not occur in any
 *  translated text (so it's an opaque ASCII token, rendered white at 1pt). */
export const SIGNATURE_ANCHOR = "XULPSIGNATUREANCHORX";

/** Court-ready stylesheet for the translated document. The GLOBAL certified title
 *  is the largest element; the document's own title (the body `h1` from the model)
 *  is a step smaller, giving clear hierarchy. Tables render label-value blocks with
 *  a distinct (bold) label column. The signature anchor is invisible (white, 1pt). */
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
  /* mupdf honors ABSOLUTE column widths (pt) but ignores % / table-layout:fixed
     when a value is long → it collapses the label column and text overlaps. A
     fixed-pt first column keeps label-value tables (the reference's layout) clean. */
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

/**
 * Composes the full HTML of a certified translation: the GLOBAL title (stating the
 * language direction), the already-rendered translated `bodyHtml` (which begins with
 * the document's own title as an `h1`), and the translator's certification block
 * ("I, {name}, hereby certify …" + a "Signature:" line with the invisible stamp
 * anchor + "Date:"). Pure + synchronous so it can be unit-tested without the WASM
 * renderer. All fixed strings are in the TARGET language.
 *
 * @param bodyHtml HTML already rendered by markdown-it with `html:false` (so any
 *   HTML in the source is escaped). Injected VERBATIM — pass only markdown-it (or
 *   equivalently sanitized) output, never arbitrary user/model HTML. The output is
 *   rendered to PDF by mupdf (not a browser), so XSS does not apply, but this
 *   invariant keeps the function misuse-resistant.
 */
export function buildCertifiedTranslationHtml(
  bodyHtml: string,
  direction: TranslationDirection,
  opts: CertifiedTranslationOptions = {},
): string {
  const toEnglish = direction === "es-en"; // the translated output is English
  const esc = (s: string) =>
    String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

  const name = opts.signerName?.trim() || "";
  const date = opts.signedDate?.trim() || "";

  const t = toEnglish
    ? {
        globalTitle: "CERTIFIED TRANSLATION FROM SPANISH TO ENGLISH",
        certHeading: "TRANSLATION CERTIFICATION",
        certStmt: name
          ? `I, ${esc(name)}, hereby certify that I translated the attached document from Spanish into English and that, to the best of my ability, it is a true and correct translation. I further certify that I am competent in both Spanish and English to render and certify such translation.`
          : "I hereby certify that the attached document was translated from Spanish into English and that, to the best of my ability, it is a true and correct translation, rendered by a person competent in both Spanish and English.",
        signature: "Signature:",
        date: "Date:",
      }
    : {
        globalTitle: "TRADUCCIÓN CERTIFICADA DEL INGLÉS AL ESPAÑOL",
        certHeading: "CERTIFICACIÓN DE LA TRADUCCIÓN",
        certStmt: name
          ? `Yo, ${esc(name)}, certifico que traduje el documento adjunto del inglés al español y que, según mi leal saber y entender, es una traducción fiel y correcta. Certifico además que soy competente en ambos idiomas (inglés y español) para realizar y certificar dicha traducción.`
          : "Certifico que el documento adjunto fue traducido del inglés al español y que, según mi leal saber y entender, es una traducción fiel y correcta, realizada por una persona competente en ambos idiomas (inglés y español).",
        signature: "Firma:",
        date: "Fecha:",
      };

  return (
    `<!DOCTYPE html><html><head>${TRANSLATION_STYLE}</head><body>` +
    `<div class="xt-global-title">${esc(t.globalTitle)}</div>` +
    `<hr class="xt-global-rule"/>` +
    bodyHtml +
    `<div class="xt-cert-heading">${esc(t.certHeading)}</div>` +
    `<p class="xt-cert-stmt">${t.certStmt}</p>` +
    `<p class="xt-sig-line"><span class="xt-sig-label">${esc(t.signature)}</span> <span class="xt-sig-anchor">${SIGNATURE_ANCHOR}</span></p>` +
    `<div class="xt-sig-space"></div>` +
    `<p class="xt-sig-date">${esc(t.date)} ${esc(date)}</p>` +
    `</body></html>`
  );
}

/** [x0,y0,x1,y1] top-left-origin rect from a mupdf search quad (8-number array or
 *  `{ul,lr}` object across mupdf versions). Returns null if unrecognized. */
function quadToRect(
  quad: unknown,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (Array.isArray(quad) && typeof quad[0] === "number") {
    const q = quad as number[];
    if (q.length >= 8) {
      return {
        x0: Math.min(q[0], q[4]),
        y0: Math.min(q[1], q[3]),
        x1: Math.max(q[2], q[6]),
        y1: Math.max(q[5], q[7]),
      };
    }
    if (q.length === 4) return { x0: q[0], y0: q[1], x1: q[2], y1: q[3] };
  }
  const o = quad as { ul?: { x: number; y: number }; lr?: { x: number; y: number } };
  if (o?.ul && o?.lr) return { x0: o.ul.x, y0: o.ul.y, x1: o.lr.x, y1: o.lr.y };
  return null;
}

/**
 * Stamps a signature image onto a generated certified-translation PDF. mupdf's
 * HTML engine cannot embed inline `<img>` (confirmed), so the document carries an
 * invisible `SIGNATURE_ANCHOR` sentinel at the signature spot; we locate it via
 * structured-text search and draw the image just to the right of it, extending down
 * into the reserved space, with `device.fillImage` while re-writing each page.
 *
 * Robust: a missing/invalid image or a missing anchor returns the PDF unchanged.
 * Geometry (page-space = top-left origin; positive `d` = upright) verified empirically.
 */
export async function stampSignatureOnPdf(
  pdfBytes: Uint8Array,
  imageBytes: Uint8Array,
  opts: { anchor?: string; maxWidthPt?: number; maxHeightPt?: number; gapPt?: number } = {},
): Promise<Uint8Array> {
  const anchor = opts.anchor ?? SIGNATURE_ANCHOR;
  const mupdf = await import("mupdf");

  const M = mupdf as any;
  const src = M.Document.openDocument(pdfBytes, "application/pdf");
  try {
    let image: { getWidth(): number; getHeight(): number };
    try {
      image = new M.Image(imageBytes);
    } catch {
      return pdfBytes; // undecodable image → leave the PDF as-is
    }
    const iw = image.getWidth();
    const ih = image.getHeight();
    if (!iw || !ih) return pdfBytes;
    const maxW = opts.maxWidthPt ?? 165;
    const maxH = opts.maxHeightPt ?? 48;
    let drawW = maxW;
    let drawH = (maxW * ih) / iw;
    if (drawH > maxH) {
      drawH = maxH;
      drawW = (maxH * iw) / ih;
    }

    // Locate the anchor (page index + position) via structured-text search.
    const n: number = src.countPages();
    let target: { page: number; x: number; y: number } | null = null;
    for (let i = 0; i < n && !target; i++) {
      const stext = src.loadPage(i).toStructuredText("preserve-whitespace");
      let hits: unknown;
      try {
        hits = stext.search(anchor);
      } catch {
        hits = null;
      }
      if (Array.isArray(hits) && hits.length > 0) {
        let q: unknown = hits[0];
        while (Array.isArray(q) && Array.isArray((q as unknown[])[0])) q = (q as unknown[])[0];
        const rect = quadToRect(q);
        if (rect) target = { page: i, x: rect.x1 + (opts.gapPt ?? 4), y: rect.y0 - 2 };
      }
    }
    if (!target) return pdfBytes; // anchor not found → no stamp

    const buf = new M.Buffer();
    const writer = new M.DocumentWriter(buf, "pdf", "");
    for (let i = 0; i < n; i++) {
      const page = src.loadPage(i);
      const dev = writer.beginPage(page.getBounds());
      page.run(dev, M.Matrix.identity);
      if (i === target.page) {
        // ctm maps the image's unit square to [x, y, drawW, drawH] in page space.
        dev.fillImage(image, [drawW, 0, 0, drawH, target.x, target.y], 1);
      }
      writer.endPage();
    }
    writer.close();
    return buf.asUint8Array() as Uint8Array;
  } finally {
    try { src.destroy?.(); } catch { /* freed */ }
  }
}

/**
 * Renders the translated text (Markdown) to a certified-translation PDF: md→HTML
 * (markdown-it, `breaks:true` to keep line structure, `html:false` for safety),
 * wrapped with the global title + the document body + the certification block,
 * then — if a signature image is provided — STAMPED with it. mupdf paginates long
 * bodies on its own.
 */
export async function renderCertifiedTranslationPdf(
  bodyMarkdown: string,
  direction: TranslationDirection,
  opts: CertifiedTranslationOptions = {},
): Promise<Uint8Array> {
  const MarkdownIt = (await import("markdown-it")).default;
  const mdi = new MarkdownIt({ html: false, linkify: false, breaks: true });
  const bodyHtml = mdi.render(bodyMarkdown);
  const pdfBytes = await htmlToPdf(buildCertifiedTranslationHtml(bodyHtml, direction, opts));
  if (opts.signatureImageBytes && opts.signatureImageBytes.length > 0) {
    return stampSignatureOnPdf(pdfBytes, opts.signatureImageBytes);
  }
  return pdfBytes;
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
export async function compileExpedientePdf(
  items: ExpedienteItemInput[],
  opts?: { tocTitle?: string },
): Promise<CompiledExpediente> {
  const mupdf = await import("mupdf");

  const M = mupdf as any;
  // Master index header — English by default (the case file is filed with the US
  // immigration court in English; item titles are already English). Parametrized
  // so a caller can localize without touching the engine.
  const tocTitle = opts?.tocTitle ?? "Table of Contents";

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
      <div style="font-size:22pt;font-weight:bold;margin:0 0 4pt">${esc(tocTitle)}</div>
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
  // The TOC carries each item's START page (logical navigation); a continuous Bates
  // foliation (USALP-0001…) is stamped on every page by stampBates below — a
  // separate pdf-lib pass, since the mupdf WASM build can't substitute fonts for
  // on-device text.
  const dst = new M.PDFDocument();
  const graft = (src: any) => {
    const n = src.countPages();
    for (let i = 0; i < n; i++) dst.graftPage(dst.countPages(), src, i);
  };
  graft(tocPdf);
  for (const o of opened) graft(o.doc);

  const merged = dst.saveToBuffer("").asUint8Array() as Uint8Array;
  try { tocPdf?.destroy?.(); } catch { /* freed */ }
  for (const o of opened) { try { o.doc.destroy?.(); } catch { /* freed */ } }
  try { dst.destroy?.(); } catch { /* freed */ }

  const pdf = await stampBates(merged);

  return { pdf, pageCount: totalPages, toc };
}

// ---------------------------------------------------------------------------
// G. countPdfPages — page count of an arbitrary PDF (exhibit page_count)
// ---------------------------------------------------------------------------

/** Returns the page count of a PDF (≥ 1). Used to record an exhibit's length. */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const mupdf = await import("mupdf");

  const M = mupdf as any;
  const doc = M.Document.openDocument(bytes, "application/pdf");
  try {
    return Math.max(1, doc.countPages());
  } finally {
    try { doc.destroy?.(); } catch { /* freed */ }
  }
}

// ---------------------------------------------------------------------------
// H. stampBates — continuous legal foliation on every page (USALP-0001…)
// ---------------------------------------------------------------------------

/**
 * Stamps a continuous Bates number (e.g. "USALP-0001") on the bottom-right of every
 * page — the legal foliation of a filed packet (essential at 200+ pages). Uses
 * pdf-lib's built-in Helvetica (no embedded font asset needed; mupdf WASM can't
 * substitute fonts on-device, which is why this is a separate post-merge pass).
 *
 * Best-effort: if the merged PDF can't be re-processed, returns the original bytes
 * unstamped rather than failing the whole compilation.
 */
export async function stampBates(
  pdfBytes: Uint8Array,
  prefix = "USALP-",
  startNumber = 1,
): Promise<Uint8Array> {
  try {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const size = 8;
    pages.forEach((page, i) => {
      const label = `${prefix}${String(startNumber + i).padStart(4, "0")}`;
      const w = font.widthOfTextAtSize(label, size);
      page.drawText(label, {
        x: page.getWidth() - w - 36, // 0.5in from the right edge
        y: 18, // ~0.25in from the bottom
        size,
        font,
        color: rgb(0.42, 0.42, 0.42),
      });
    });
    return await doc.save();
  } catch (err) {
    const { logger } = await import("./logger");
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "stampBates: degraded (returning unstamped)");
    return pdfBytes;
  }
}
